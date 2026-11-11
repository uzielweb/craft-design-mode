import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { createDesignStore } from '@design-mode/vector-core';
import {
  EffectCraftBridge,
  FilmCraftBridge,
  HttpRelayTransport,
  type HostCommandCall,
} from '@design-mode/host-bridge';
import {
  CanvasPanel,
  LayersPanel,
  PropertiesPanel,
} from '@design-mode/ui-panels';

type HostTarget = 'filmcraft' | 'effectcraft';

interface BridgeHealth {
  filmcraft?: { reachable: boolean; port: number };
  effectcraft?: { reachable: boolean; port: number };
}

export const App: React.FC = () => {
  const store = useMemo(() => createDesignStore(), []);
  const state = useStore(store);

  const [useLiveBridge, setUseLiveBridge] = useState(false);
  const [health, setHealth] = useState<BridgeHealth>({});

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const res = await fetch('/health');
        if (!res.ok) return;
        const data = (await res.json()) as BridgeHealth;
        if (!cancelled) {
          setHealth(data);
          if (data.effectcraft?.reachable || data.filmcraft?.reachable) {
            setUseLiveBridge(true);
          }
        }
      } catch {
        // Bridge server offline — stay in simulated mode
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  const filmcraftBridge = useMemo(
    () =>
      new FilmCraftBridge(
        useLiveBridge ? new HttpRelayTransport('/rpc/filmcraft') : undefined,
      ),
    [useLiveBridge],
  );
  const effectcraftBridge = useMemo(
    () =>
      new EffectCraftBridge(
        useLiveBridge ? new HttpRelayTransport('/rpc/effectcraft') : undefined,
      ),
    [useLiveBridge],
  );

  const [hostTarget, setHostTarget] = useState<HostTarget>('effectcraft');
  const [playheadSec, setPlayheadSec] = useState(1.5);
  const [statusMsg, setStatusMsg] = useState('Ready (Demo AST loaded)');
  const [lastCalls, setLastCalls] = useState<HostCommandCall[]>([]);

  const activeBridge =
    hostTarget === 'filmcraft' ? filmcraftBridge : effectcraftBridge;
  const isTargetReachable =
    hostTarget === 'filmcraft'
      ? Boolean(health.filmcraft?.reachable)
      : Boolean(health.effectcraft?.reachable);

  const handlePull = async (mode: 'all' | 'selected') => {
    try {
      const [nodes, bgColor, fonts] = await Promise.all([
        activeBridge.pull(mode),
        activeBridge.getCompBackgroundColor(),
        activeBridge.getInstalledFonts(),
      ]);
      state.setCachedFonts(fonts);
      state.setPulledNodes(
        nodes,
        state.preferences.matchCompBackground ? bgColor : undefined,
        mode === 'all',
      );
      setLastCalls(activeBridge.getTransport().getCommandLog());
      setStatusMsg(
        `Pulled ${nodes.length} (${mode}) from ${activeBridge.hostName} (${useLiveBridge ? 'LIVE' : 'Simulated'}, ${fonts.length} fonts)`,
      );
    } catch (err) {
      setStatusMsg(
        `Pull error (${activeBridge.hostName}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const handlePush = async () => {
    try {
      activeBridge.getTransport().clearCommandLog();
      await activeBridge.push(state.doc.nodes, playheadSec);
      const log = activeBridge.getTransport().getCommandLog();
      setLastCalls(log);
      setStatusMsg(
        `Pushed ${state.doc.nodes.length} root nodes to ${activeBridge.hostName} (${useLiveBridge ? 'LIVE' : 'Simulated'}) @ t=${playheadSec.toFixed(2)}s (${log.length} commands)`,
      );
    } catch (err) {
      setStatusMsg(
        `Push error (${activeBridge.hostName}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
        background: '#0d0f13',
      }}
    >
      {/* Top Studio Bar */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: '#14171d',
          borderBottom: '1px solid #262b36',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <strong style={{ fontSize: 13, letterSpacing: '0.02em', color: '#f8fafc' }}>
            Craft Design Mode
          </strong>
          <span className="dm-badge">AST v1</span>

          <button
            type="button"
            className="dm-btn"
            disabled={!state.canUndo}
            onClick={() => state.undo()}
          >
            Undo
          </button>
          <button
            type="button"
            className="dm-btn"
            disabled={!state.canRedo}
            onClick={() => state.redo()}
          >
            Redo
          </button>
        </div>

        {/* Host Bridge Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className={`dm-btn ${useLiveBridge ? (isTargetReachable ? 'active' : 'warn') : ''}`}
            onClick={() => setUseLiveBridge((v) => !v)}
            title="Toggle Live TCP Relay vs Simulated Host"
          >
            {useLiveBridge
              ? isTargetReachable
                ? 'LIVE TCP'
                : 'LIVE (Offline)'
              : 'Simulated'}
          </button>

          <select
            className="dm-select"
            style={{ width: 145 }}
            value={hostTarget}
            onChange={(e) => setHostTarget(e.target.value as HostTarget)}
          >
            <option value="effectcraft">Bridge: EffectCraft</option>
            <option value="filmcraft">Bridge: FilmCraft</option>
          </select>

          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#94a3b8' }}>
            Playhead (s)
            <input
              type="number"
              step={0.1}
              min={0}
              className="dm-input"
              style={{ width: 64 }}
              value={playheadSec}
              onChange={(e) => setPlayheadSec(Math.max(0, Number(e.target.value) || 0))}
            />
          </label>

          <button type="button" className="dm-btn" onClick={() => void handlePull('all')}>
            Pull All
          </button>
          <button type="button" className="dm-btn" onClick={() => void handlePull('selected')}>
            Pull Selected
          </button>
          <button type="button" className="dm-btn active" onClick={() => void handlePush()}>
            Push to Host
          </button>
        </div>
      </header>

      {/* 3 Dockable Panels: Layers | Canvas | Properties */}
      <main
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          gap: 2,
          padding: 2,
          background: '#0d0f13',
        }}
      >
        <LayersPanel store={store} />
        <CanvasPanel store={store} />
        <PropertiesPanel
          store={store}
          onRefreshFonts={() => activeBridge.getInstalledFonts()}
        />
      </main>

      {/* Bridge Status & Last Dispatched Commands Strip */}
      <footer
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 12px',
          background: '#14171d',
          borderTop: '1px solid #262b36',
          fontSize: 11,
          color: '#94a3b8',
          gap: 12,
        }}
      >
        <span>{statusMsg}</span>
        <span style={{ fontFamily: 'monospace', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lastCalls.length > 0
            ? `Last Bridge Calls: ${lastCalls.map((c) => c.command).join(' → ')}`
            : 'Shortcuts: V Select · P Pen · O Ellipse · L Line · Shift+V Mode · V+V/R+R/S+S Numeric · X/Y Axis Lock · Ctrl+G Group'}
        </span>
      </footer>
    </div>
  );
};
