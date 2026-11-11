import type { VectorNode } from '@design-mode/vector-core';

export interface IHostBridge {
  pull(mode: 'all' | 'selected'): Promise<VectorNode[]>;
  push(nodes: VectorNode[], currentTime: number): Promise<void>;
  getCompBackgroundColor(): Promise<string>;
  getInstalledFonts(): Promise<string[]>;
}

export interface HostCommandCall {
  command: string;
  params: Record<string, unknown>;
  timestamp: number;
}

export interface HostTransport {
  readonly kind: 'simulated' | 'http-relay' | 'tcp-control';
  execute<T = unknown>(
    command: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
  getCommandLog(): HostCommandCall[];
  clearCommandLog(): void;
}

export class SimulatedHostTransport implements HostTransport {
  readonly kind = 'simulated' as const;
  private log: HostCommandCall[] = [];

  constructor(
    private handler?: (
      command: string,
      params: Record<string, unknown>,
    ) => unknown,
  ) {}

  async execute<T = unknown>(
    command: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    this.log.push({ command, params, timestamp: Date.now() });
    if (this.handler) {
      return this.handler(command, params) as T;
    }
    return {} as T;
  }

  getCommandLog(): HostCommandCall[] {
    return [...this.log];
  }

  clearCommandLog(): void {
    this.log = [];
  }
}

/**
 * Browser-safe HTTP/JSON relay transport that forwards commands
 * to a local bridge daemon talking to FilmCraft (:7982) or EffectCraft (:7983).
 */
export class HttpRelayTransport implements HostTransport {
  readonly kind = 'http-relay' as const;
  private log: HostCommandCall[] = [];

  constructor(private endpointUrl: string) {}

  async execute<T = unknown>(
    command: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    this.log.push({ command, params, timestamp: Date.now() });
    const response = await fetch(this.endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'engine.execute',
        params: { command, params },
      }),
    });
    if (!response.ok) {
      throw new Error(`Host relay HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      ok?: boolean;
      result?: T;
      error?: string;
    };
    if (payload.ok === false) {
      throw new Error(payload.error ?? 'Unknown host error');
    }
    return (payload.result ?? {}) as T;
  }

  getCommandLog(): HostCommandCall[] {
    return [...this.log];
  }

  clearCommandLog(): void {
    this.log = [];
  }
}
