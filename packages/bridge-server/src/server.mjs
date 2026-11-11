import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const PORT = Number(process.env.DESIGN_MODE_PORT || 4173);
const HOST = '127.0.0.1';

const REPO_ROOT = path.resolve(
  decodeURIComponent(new URL('../../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'),
);
const STUDIO_DIST = path.join(REPO_ROOT, 'apps', 'studio', 'dist');

const TARGETS = {
  filmcraft: {
    port: Number(process.env.FILMCRAFT_CONTROL_PORT || 7982),
    envToken: process.env.FILMCRAFT_CONTROL_TOKEN || null,
    probeCommand: 'project.inspect',
    tokenPaths: [
      path.join(process.env.LOCALAPPDATA || '', 'filmcraft-control-7982.token'),
      path.join(process.env.APPDATA || '', 'FilmCraft', 'control-key.local-7982'),
    ],
  },
  effectcraft: {
    port: Number(process.env.EFFECTCRAFT_CONTROL_PORT || 7983),
    envToken: process.env.EFFECTCRAFT_CONTROL_TOKEN || null,
    probeCommand: 'file.scripts.list',
    tokenPaths: [
      path.join(process.env.LOCALAPPDATA || '', 'effectcraft-control-7983.token'),
      path.join(process.env.APPDATA || '', 'EffectCraft', 'control-key.local-7983'),
    ],
  },
};

function readToken(targetName) {
  const cfg = TARGETS[targetName];
  if (!cfg) return null;
  if (cfg.envToken) return cfg.envToken;
  for (const candidate of cfg.tokenPaths) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        const token = fs.readFileSync(candidate, 'utf8').trim();
        if (token) return token;
      }
    } catch {
      // Ignore unreadable token files
    }
  }
  return null;
}

let rpcCounter = 1;

/**
 * Connects via loopback TCP using ArtCraft's UTF-8 without BOM JSON-lines protocol.
 */
function sendTcpCommand(targetName, method, params) {
  return new Promise((resolve, reject) => {
    const cfg = TARGETS[targetName];
    if (!cfg) {
      reject(new Error(`Unknown target: ${targetName}`));
      return;
    }

    const token = readToken(targetName);
    const id = rpcCounter++;
    const payload = { id, method, params };
    if (token) payload.token = token;

    const socket = net.createConnection({ host: '127.0.0.1', port: cfg.port });
    let buffer = '';
    let settled = false;

    const finish = (err, data) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(data);
    };

    socket.setTimeout(5000);
    socket.on('timeout', () => finish(new Error(`${targetName} TCP timeout on :${cfg.port}`)));
    socket.on('error', (err) => finish(err));

    socket.on('connect', () => {
      // Strictly UTF-8 WITHOUT BOM
      const jsonLine = `${JSON.stringify(payload)}\n`;
      socket.write(Buffer.from(jsonLine, 'utf8'));
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const nl = buffer.indexOf('\n');
      if (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        try {
          const parsed = JSON.parse(line);
          finish(null, parsed);
        } catch (err) {
          finish(err);
        }
      }
    });
  });
}

async function probeTarget(targetName) {
  try {
    const cfg = TARGETS[targetName];
    const res = await sendTcpCommand(targetName, 'engine.execute', {
      command: cfg.probeCommand,
      params: {},
    });
    return { reachable: true, ok: res.ok !== false, port: cfg.port };
  } catch (err) {
    return {
      reachable: false,
      port: TARGETS[targetName].port,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function serveStatic(reqPath, res) {
  const cleanRel = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
  const resolved = path.resolve(STUDIO_DIST, cleanRel);
  if (!resolved.startsWith(STUDIO_DIST) || !fs.existsSync(resolved)) {
    const indexHtml = path.join(STUDIO_DIST, 'index.html');
    if (fs.existsSync(indexHtml)) {
      res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
      fs.createReadStream(indexHtml).pipe(res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Studio dist not found. Run `npm run build` first.');
    return;
  }
  const ext = path.extname(resolved).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
  fs.createReadStream(resolved).pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  if (req.method === 'GET' && reqUrl.pathname === '/health') {
    const [filmcraft, effectcraft] = await Promise.all([
      probeTarget('filmcraft'),
      probeTarget('effectcraft'),
    ]);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, filmcraft, effectcraft }));
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname.startsWith('/rpc/')) {
    const targetName = reqUrl.pathname.slice('/rpc/'.length);
    if (!TARGETS[targetName]) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: `Unknown target ${targetName}` }));
      return;
    }

    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
    }

    try {
      const body = JSON.parse(raw || '{}');
      const result = await sendTcpCommand(
        targetName,
        body.method || 'engine.execute',
        body.params || {},
      );
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return;
  }

  serveStatic(reqUrl.pathname, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Craft Design Mode Bridge & Studio running at http://${HOST}:${PORT}`);
  console.log(`  FilmCraft TCP target:  127.0.0.1:${TARGETS.filmcraft.port}`);
  console.log(`  EffectCraft TCP target: 127.0.0.1:${TARGETS.effectcraft.port}`);
});
