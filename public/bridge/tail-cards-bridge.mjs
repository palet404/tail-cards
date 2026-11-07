#!/usr/bin/env node
// Tail Cards 로컬 브리지
// 웹 페이지(Tail Cards)가 내 PC의 Claude Code(내 Claude 구독으로 로그인된 CLI)로 카드를 만들 수 있게 이어 준다.
//
// 안전장치
//  - 127.0.0.1에서만 열림 (같은 PC에서만 접근)
//  - 페어링 토큰이 있는 요청만 처리 (토큰은 ~/.tail-cards-bridge.json 에 저장)
//  - 토큰은 --app 으로 허용한 주소의 페이지에만 자동으로 건넨다
//  - Claude는 도구 없이(--tools "") 텍스트만 생성: 파일 읽기/쓰기·명령 실행 불가
//  - 한 번에 한 작업만 실행
//
// 사용: node tail-cards-bridge.mjs [--app <앱 주소> ...] [--port 47321] [--new-token]
//  - --app 으로 준 주소에서 연 페이지는 /pair 로 자동 연결된다 (다른 사이트는 거부)
// 필요: Node 18+, Claude Code CLI 설치 + `claude auth login`(구독 계정)

import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VERSION = '1';
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const PORT = Number(arg('port', process.env.TAIL_CARDS_BRIDGE_PORT ?? 47321));
// --app 은 여러 번 줄 수 있다. 이 주소(origin)에서 연 페이지만 자동 연결(/pair)로 토큰을 받는다.
const APPS = argv.flatMap((a, i) => (a === '--app' && argv[i + 1] ? [argv[i + 1]] : []));
if (!APPS.length) APPS.push('http://localhost:5173/');
const APP = APPS[0].replace(/\/?$/, '/');
const ALLOWED_ORIGINS = new Set(
  APPS.map((u) => {
    try {
      return new URL(u).origin;
    } catch {
      return null;
    }
  }).filter(Boolean),
);
const CFG = path.join(os.homedir(), '.tail-cards-bridge.json');
const TIMEOUT_MS = 10 * 60 * 1000;

// ---------- 토큰 ----------
function loadToken() {
  if (!argv.includes('--new-token')) {
    try {
      const t = JSON.parse(fs.readFileSync(CFG, 'utf8')).token;
      if (typeof t === 'string' && t.length >= 32) return t;
    } catch {}
  }
  const t = randomBytes(24).toString('hex');
  fs.writeFileSync(CFG, JSON.stringify({ token: t }, null, 2), { mode: 0o600 });
  return t;
}
const TOKEN = loadToken();
const tokenOk = (h) => {
  const got = Buffer.from(String(h ?? '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(TOKEN);
  return got.length === want.length && timingSafeEqual(got, want);
};

// ---------- claude 실행 파일 찾기 ----------
function findClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  if (process.platform === 'win32') {
    const c = [
      path.join(process.env.USERPROFILE ?? '', '.local', 'bin', 'claude.exe'),
      path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    ];
    for (const p of c) if (fs.existsSync(p)) return p;
    return null;
  }
  return 'claude';
}
const CLAUDE = findClaude();

function run(args, input = '', timeout = 60000) {
  return new Promise((resolve) => {
    if (!CLAUDE) return resolve({ code: -1, stdout: '', stderr: 'claude CLI를 찾을 수 없습니다' });
    let child;
    try {
      child = spawn(CLAUDE, args, { cwd: os.tmpdir(), windowsHide: true, env: process.env });
    } catch (e) {
      return resolve({ code: -1, stdout: '', stderr: String(e?.message ?? e) });
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(e?.message ?? e) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

// ---------- 상태 ----------
let statusCache = { at: 0, value: null };
async function status() {
  if (Date.now() - statusCache.at < 20000 && statusCache.value) return statusCache.value;
  const v = await run(['--version']);
  const a = await run(['auth', 'status']);
  let auth = {};
  try {
    auth = JSON.parse(a.stdout);
  } catch {}
  const value = {
    bridge: VERSION,
    claudeFound: !!CLAUDE && v.code === 0,
    claudeVersion: v.stdout.trim() || null,
    loggedIn: !!auth.loggedIn,
    authMethod: auth.authMethod ?? null,
    busy,
  };
  statusCache = { at: Date.now(), value };
  return value;
}

// ---------- 생성 ----------
let busy = false;
async function generate({ system, prompt, model, effort }) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--tools', '',
    '--system-prompt', system,
    '--no-session-persistence',
    '--strict-mcp-config',
    '--disable-slash-commands',
  ];
  if (model && /^[\w.-]+$/.test(model)) args.push('--model', model);
  if (effort && /^(low|medium|high|xhigh|max)$/.test(effort)) args.push('--effort', effort);
  const r = await run(args, prompt, TIMEOUT_MS);
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    throw new Error((r.stderr || r.stdout || `claude 종료 코드 ${r.code}`).trim().slice(0, 800));
  }
  if (out.is_error) throw new Error(String(out.result ?? out.error ?? '생성 실패').slice(0, 800));
  return { markdown: String(out.result ?? ''), durationMs: out.duration_ms ?? null };
}

// ---------- HTTP ----------
function send(req, res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': req.headers.origin ?? '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
    ...(req.headers['access-control-request-private-network'] ? { 'Access-Control-Allow-Private-Network': 'true' } : {}),
  });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('요청이 너무 큽니다 (2MB 초과)'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(req, res, 204);
  // 자동 연결: 브라우저가 붙이는 Origin 헤더는 다른 웹사이트가 위조할 수 없으므로,
  // 허용된 앱 주소에서 온 요청에만 토큰을 준다.
  if (req.method === 'GET' && req.url === '/pair') {
    const origin = req.headers.origin;
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return send(req, res, 403, { error: `허용되지 않은 주소입니다: ${origin ?? '(없음)'}` });
    console.log(`[${new Date().toLocaleTimeString()}] 페이지 연결됨 (${origin})`);
    return send(req, res, 200, { token: TOKEN, port: PORT });
  }
  if (!tokenOk(req.headers.authorization)) return send(req, res, 401, { error: '페어링 토큰이 맞지 않습니다' });
  try {
    if (req.method === 'GET' && req.url === '/status') return send(req, res, 200, await status());
    if (req.method === 'POST' && req.url === '/generate') {
      if (busy) return send(req, res, 409, { error: '이미 생성 중인 작업이 있습니다' });
      const body = JSON.parse(await readBody(req));
      if (typeof body.system !== 'string' || typeof body.prompt !== 'string') return send(req, res, 400, { error: 'system, prompt가 필요합니다' });
      busy = true;
      statusCache.at = 0;
      const t0 = Date.now();
      console.log(`[${new Date().toLocaleTimeString()}] 카드 생성 시작 (${body.prompt.length.toLocaleString()}자)`);
      try {
        const out = await generate(body);
        console.log(`[${new Date().toLocaleTimeString()}] 완료 (${Math.round((Date.now() - t0) / 1000)}초)`);
        return send(req, res, 200, out);
      } finally {
        busy = false;
        statusCache.at = 0;
      }
    }
    return send(req, res, 404, { error: 'not found' });
  } catch (e) {
    console.error(`오류: ${e?.message ?? e}`);
    return send(req, res, 500, { error: String(e?.message ?? e) });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`포트 ${PORT}가 이미 사용 중입니다. 브리지가 이미 켜져 있는지 확인하거나 --port 로 바꾸세요.`);
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', async () => {
  const s = await status();
  const pair = `${APP}#/generate?bridge=${TOKEN}&port=${PORT}`;
  console.log('');
  console.log('  Tail Cards 브리지가 켜졌습니다  (http://127.0.0.1:' + PORT + ')');
  console.log('');
  if (!s.claudeFound) console.log('  ⚠ Claude Code CLI를 찾지 못했습니다. 설치 후 다시 실행하세요 (CLAUDE_BIN 환경 변수로 경로 지정 가능).');
  else if (!s.loggedIn) console.log(`  ⚠ ${s.claudeVersion} — 로그인이 필요합니다. 다른 터미널에서:  claude auth login`);
  else console.log(`  ✓ ${s.claudeVersion} · 로그인됨 (${s.authMethod})`);
  console.log('');
  console.log(`  연결 허용 주소: ${[...ALLOWED_ORIGINS].join(', ')}  (이 주소의 페이지는 자동으로 연결됩니다)`);
  console.log('  자동 연결이 안 되면 아래 링크를 브라우저에서 여세요:');
  console.log('  ' + pair);
  console.log('');
  console.log('  (이 창을 켜 둔 동안만 페이지에서 카드를 만들 수 있습니다. 끄려면 Ctrl+C)');
});
