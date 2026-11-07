import { getSetting, setSetting } from '../db/db.ts';

export interface BridgeConfig {
  token: string;
  port: number;
}

export interface BridgeStatus {
  bridge: string;
  claudeFound: boolean;
  claudeVersion: string | null;
  loggedIn: boolean;
  authMethod: string | null;
  busy: boolean;
}

export type BridgeState =
  | { kind: 'unpaired' }
  | { kind: 'offline'; cfg: BridgeConfig }
  | { kind: 'badToken'; cfg: BridgeConfig }
  | { kind: 'online'; cfg: BridgeConfig; status: BridgeStatus };

export const DEFAULT_PORT = 47321;

export async function loadBridge(): Promise<BridgeConfig | null> {
  return getSetting<BridgeConfig | null>('bridge', null);
}

export async function saveBridge(cfg: BridgeConfig | null) {
  await setSetting('bridge', cfg);
}

const base = (cfg: BridgeConfig) => `http://127.0.0.1:${cfg.port}`;
const headers = (cfg: BridgeConfig) => ({ Authorization: `Bearer ${cfg.token}` });

/** 브리지가 이 페이지 주소를 허용하면 토큰을 자동으로 받아 저장 */
export async function autoPair(port = DEFAULT_PORT): Promise<BridgeConfig | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/pair`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const { token, port: p } = (await r.json()) as { token?: string; port?: number };
    if (!token) return null;
    const cfg = { token, port: p ?? port };
    await saveBridge(cfg);
    return cfg;
  } catch {
    return null;
  }
}

export async function checkBridge(cfg: BridgeConfig | null): Promise<BridgeState> {
  const state = await checkOnce(cfg);
  // 처음이거나 토큰이 바뀌었으면 자동 연결을 시도
  if (state.kind === 'unpaired' || state.kind === 'badToken') {
    const paired = await autoPair(cfg?.port ?? DEFAULT_PORT);
    if (paired) return checkOnce(paired);
  }
  return state;
}

async function checkOnce(cfg: BridgeConfig | null): Promise<BridgeState> {
  if (!cfg) return { kind: 'unpaired' };
  try {
    const r = await fetch(`${base(cfg)}/status`, { headers: headers(cfg), signal: AbortSignal.timeout(4000) });
    if (r.status === 401) return { kind: 'badToken', cfg };
    if (!r.ok) return { kind: 'offline', cfg };
    return { kind: 'online', cfg, status: (await r.json()) as BridgeStatus };
  } catch {
    return { kind: 'offline', cfg };
  }
}

export class BridgeError extends Error {}

export async function bridgeGenerate(
  cfg: BridgeConfig,
  body: { system: string; prompt: string; model?: string },
  signal?: AbortSignal,
): Promise<string> {
  let r: Response;
  try {
    r = await fetch(`${base(cfg)}/generate`, {
      method: 'POST',
      headers: { ...headers(cfg), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new BridgeError('취소했습니다.');
    throw new BridgeError('브리지에 연결하지 못했습니다. 브리지 창이 켜져 있는지 확인해 주세요.');
  }
  const data = (await r.json().catch(() => ({}))) as { markdown?: string; error?: string };
  if (!r.ok) throw new BridgeError(data.error ?? `브리지 오류 (${r.status})`);
  return data.markdown ?? '';
}

/** 페이지 주소의 ?bridge=토큰&port= 로 페어링 (브리지가 출력한 링크) */
export async function pairFromQuery(q: URLSearchParams): Promise<boolean> {
  const token = q.get('bridge');
  if (!token || !/^[0-9a-f]{32,}$/i.test(token)) return false;
  const port = Number(q.get('port')) || DEFAULT_PORT;
  await saveBridge({ token, port });
  return true;
}
