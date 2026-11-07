import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { slugify, type Deck } from '../core/model.ts';
import { buildDeck, parseChapterMd } from '../core/parse-card-md.ts';
import { addChaptersToDeck, db, saveBundle } from '../db/db.ts';
import { BridgeError, bridgeGenerate, checkBridge, loadBridge, pairFromQuery, saveBridge, DEFAULT_PORT, type BridgeState } from '../bridge/client.ts';
import { buildPrompt, cleanOutput, loadSkill } from '../bridge/prompt.ts';
import { unixSetup, windowsSetup } from '../bridge/setup.ts';
import { downloadText, readFiles } from './download.ts';
import { href } from './route.ts';

const appUrl = () => new URL(import.meta.env.BASE_URL, location.href).href;
const assetUrl = (p: string) => new URL(`${import.meta.env.BASE_URL}${p}`, location.href).href;

function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="cmd">
      <code>{text}</code>
      <button
        className="btn sm ghost"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setOk(true);
            setTimeout(() => setOk(false), 1500);
          });
        }}
      >
        {ok ? '복사됨' : '복사'}
      </button>
    </div>
  );
}

type Result = { deckId: string; chapterId: string; title: string; cards: number; drafts: number; questions: string[]; md: string };

export function Generate({ query }: { query: URLSearchParams }) {
  const [bridge, setBridge] = useState<BridgeState | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [target, setTarget] = useState('new');
  const [deckName, setDeckName] = useState('');
  const [subject, setSubject] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [raw, setRaw] = useState(false);
  const [tone, setTone] = useState('');
  const [busySince, setBusySince] = useState<number | null>(null);
  const [, tick] = useState(0);
  const [err, setErr] = useState<{ text: string; output?: string } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const abort = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => setBridge(await checkBridge(await loadBridge())), []);

  // 브리지가 출력한 링크(#/generate?bridge=…&port=…)로 들어오면 페어링하고 주소에서 토큰 제거
  useEffect(() => {
    void (async () => {
      if (await pairFromQuery(query)) history.replaceState(null, '', `${location.pathname}${location.search}#/generate`);
      await refresh();
    })();
  }, [query, refresh]);

  useEffect(() => {
    if (busySince) return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [busySince, refresh]);

  useEffect(() => {
    if (!busySince) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [busySince]);

  useEffect(() => {
    void db.decks.toArray().then((ds) => {
      const mine = ds.filter((d) => !d.builtIn);
      setDecks(mine);
      if (mine.length) setTarget(mine[0].id);
    });
  }, [result]);

  const ready = bridge?.kind === 'online' && bridge.status.loggedIn && bridge.status.claudeFound;

  async function generate() {
    if (bridge?.kind !== 'online') return;
    if (!note.trim()) return setErr({ text: '노트를 붙여넣거나 파일을 열어 주세요.' });
    const t = title.trim() || '새 단원';
    const subj = subject.trim() || deckName.trim() || '전공';
    setErr(null);
    setResult(null);
    setBusySince(Date.now());
    abort.current = new AbortController();
    try {
      const skill = await loadSkill();
      const out = await bridgeGenerate(bridge.cfg, buildPrompt(skill, { subject: subj, title: t, note, raw, tone: tone.trim() || undefined }), abort.current.signal);
      const md = cleanOutput(out);
      const fileName = `${t} (카드형).md`;
      const probe = parseChapterMd(md, { deckId: 'probe', fileName, order: 0 });
      if (!probe.cards.length) {
        setErr({ text: '결과에서 카드(### Q…)를 찾지 못했습니다. 다시 시도해 보세요.', output: out });
        return;
      }
      let deckId = target;
      if (target === 'new') {
        deckId = `user-${Date.now().toString(36)}`;
        const name = deckName.trim() || subj;
        await saveBundle(buildDeck([{ fileName, md }], { id: deckId, title: name, subject: name, description: 'Claude Code로 만든 꼬리질문 카드', builtIn: false }));
      } else {
        await addChaptersToDeck(deckId, [{ fileName, md }]);
      }
      setResult({
        deckId,
        chapterId: `${deckId}:${slugify(fileName)}`,
        title: t,
        cards: probe.cards.filter((c) => !c.draft).length,
        drafts: probe.cards.filter((c) => c.draft).length,
        questions: probe.cards.map((c) => `${c.num}. ${c.question}`),
        md,
      });
    } catch (e) {
      setErr({ text: e instanceof BridgeError ? e.message : String((e as Error)?.message ?? e) });
    } finally {
      setBusySince(null);
      void refresh();
    }
  }

  const elapsed = busySince ? Math.floor((Date.now() - busySince) / 1000) : 0;

  return (
    <div className="stack-lg">
      <div>
        <h1 className="page-title">노트로 카드 만들기</h1>
        <p className="muted">
          노트를 넣으면 내 PC의 <b>Claude Code</b>(내 Claude 구독)가 CS-Tutor 로직으로 꼬리질문 카드를 만들고, 바로 덱에 들어갑니다. API 키는 필요 없습니다.
        </p>
      </div>

      <BridgePanel state={bridge} onChange={refresh} />

      <section className="panel stack">
        <div className="grid2">
          <label className="field">
            <span>넣을 덱</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="new">+ 새 덱 만들기</option>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </label>
          {target === 'new' && (
            <label className="field">
              <span>새 덱 이름</span>
              <input value={deckName} onChange={(e) => setDeckName(e.target.value)} placeholder="예: 운영체제" />
            </label>
          )}
          <label className="field">
            <span>과목</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="예: 컴퓨터 구조" />
          </label>
          <label className="field">
            <span>단원 제목</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 3.3 곱셈" />
          </label>
        </div>
        <label className="field">
          <span className="row between">
            노트 (마크다운 · 텍스트)
            <button
              className="btn sm"
              type="button"
              onClick={async () => {
                const [f] = await readFiles('.md,.txt,text/markdown,text/plain', false);
                if (f) {
                  setNote(f.text);
                  if (!title) setTitle(f.name.replace(/\.(md|txt)$/i, ''));
                }
              }}
            >
              파일 열기
            </button>
          </span>
          <textarea rows={14} value={note} onChange={(e) => setNote(e.target.value)} placeholder="정리한 개념 노트나 교재 본문을 붙여넣으세요. ## 헤딩이 있으면 카드의 근거 링크로 쓰입니다." />
        </label>
        <label className="check">
          <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} />
          교재 원문/거친 메모예요 → 면접 깊이의 개념 정리(7단계 또는 방법론형)부터
        </label>
        <details>
          <summary className="muted small">말투 샘플 (선택) — "풀어 말하기"를 내 말투로</summary>
          <textarea rows={4} value={tone} onChange={(e) => setTone(e.target.value)} placeholder="내가 쓴 면접 답변 문단 하나를 붙여넣으세요" />
        </details>

        {busySince ? (
          <p className="toast busy">
            <span className="spinner" /> Claude Code가 카드를 만드는 중… {elapsed}초 (보통 1~3분)
            <button className="btn sm ghost" onClick={() => abort.current?.abort()}>
              취소
            </button>
          </p>
        ) : (
          <div className="row between">
            <span className="muted small">{ready ? '✓ 브리지 연결됨' : '위의 브리지 연결을 먼저 마쳐 주세요'}</span>
            <button className="btn primary" disabled={!ready || !note.trim()} onClick={() => void generate()}>
              카드 만들기
            </button>
          </div>
        )}

        {err && (
          <div className="toast error">
            {err.text}
            {err.output && (
              <button className="btn sm ghost" onClick={() => downloadText('tail-cards-output.md', err.output!)}>
                받은 출력 보기
              </button>
            )}
          </div>
        )}

        {result && (
          <div className="result">
            <p>
              <b>{result.title}</b> — 카드 {result.cards}장{result.drafts ? ` · ✍️ 직접 채울 카드 ${result.drafts}장` : ''} 저장됨
            </p>
            <ol className="small muted">
              {result.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ol>
            <div className="row">
              <a className="btn primary" href={href(['chapter', result.deckId, result.chapterId])}>
                카드 보기
              </a>
              <a className="btn" href={href(['study', result.deckId], { mode: 'chain', chapter: result.chapterId })}>
                바로 체인 연습
              </a>
              <button className="btn ghost" onClick={() => downloadText(`${result.title} (카드형).md`, result.md)}>
                .md 저장 (Obsidian용)
              </button>
            </div>
          </div>
        )}
      </section>

      <details className="panel advanced">
        <summary>
          <b>이미 만든 (카드형).md 가져오기</b> <span className="muted small">— CS-Tutor <code>/card-interview</code> 결과 등</span>
        </summary>
        <ImportPanel decks={decks} />
      </details>
    </div>
  );
}

function BridgePanel({ state, onChange }: { state: BridgeState | null; onChange: () => Promise<void> }) {
  const [os, setOs] = useState<'win' | 'unix'>(() => (navigator.userAgent.includes('Windows') ? 'win' : 'unix'));
  const [code, setCode] = useState('');
  if (!state) return <section className="panel muted small">브리지 확인 중…</section>;
  const osToggle = (
    <div className="row">
      <button className={`btn sm ${os === 'win' ? 'primary' : ''}`} onClick={() => setOs('win')}>
        Windows (cmd · PowerShell)
      </button>
      <button className={`btn sm ${os === 'unix' ? 'primary' : ''}`} onClick={() => setOs('unix')}>
        macOS · Linux · Git Bash
      </button>
    </div>
  );

  const ok = state.kind === 'online' && state.status.loggedIn && state.status.claudeFound;
  if (ok)
    return (
      <section className="panel bridge ok">
        <span className="dot m_mature" /> <b>Claude Code 연결됨</b>
        <span className="muted small">
          {' '}
          · {state.status.claudeVersion} · {state.status.authMethod === 'claude.ai' ? 'Claude 구독' : state.status.authMethod}
          {state.status.busy ? ' · 생성 중' : ''}
        </span>
      </section>
    );

  const bridgeUrl = assetUrl('bridge/tail-cards-bridge.mjs');
  const app = appUrl();
  // Windows: cmd와 PowerShell 양쪽에서 그대로 되는 형태 (curl.exe는 Windows 10+ 기본 포함, 홈 폴더에서 실행)
  const downloadCmd =
    os === 'win' ? `curl.exe -fsSL "${bridgeUrl}" -o tail-cards-bridge.mjs` : `curl -fsSL "${bridgeUrl}" -o ~/tail-cards-bridge.mjs`;
  // Windows PowerShell 기본 실행 정책은 npm이 만든 .ps1 래퍼를 막으므로 .cmd로 안내 (cmd에서도 동작)
  const loginCmd = os === 'win' ? 'claude.cmd auth login' : 'claude auth login';
  const rerun = os === 'win' ? `node tail-cards-bridge.mjs --app "${app}"` : `node ~/tail-cards-bridge.mjs --app "${app}"`;

  const installer = () =>
    os === 'win'
      ? downloadText('tail-cards-setup.cmd', windowsSetup(app, bridgeUrl), 'application/octet-stream')
      : downloadText('tail-cards-setup.sh', unixSetup(app, bridgeUrl), 'text/x-shellscript');

  const title =
    state.kind === 'offline'
      ? '브리지가 꺼져 있습니다'
      : state.kind === 'online' && state.status.claudeFound && !state.status.loggedIn
        ? 'Claude Code 로그인이 필요합니다'
        : 'Claude Code와 연결하기 (처음 한 번)';

  return (
    <section className="panel bridge stack">
      <div>
        <span className="dot m_learning" /> <b>{title}</b>
      </div>

      <div className="installer">
        <button className="btn primary" onClick={installer}>
          {os === 'win' ? '설치 파일 받기 (Windows)' : '설치 스크립트 받기 (macOS · Linux)'}
        </button>
        {os === 'win' ? (
          <ol className="small">
            <li>
              받은 <code>tail-cards-setup.cmd</code>를 더블클릭 (보안 경고가 뜨면 <b>추가 정보 → 실행</b>)
            </li>
            <li>Node.js·Claude Code 설치, 로그인(브라우저에서 Claude 구독 계정), 브리지 실행·자동 시작 등록을 알아서 합니다</li>
            <li>끝나면 이 페이지가 자동으로 연결됩니다. 다음부터는 Windows에 로그인할 때 브리지가 저절로 켜집니다</li>
          </ol>
        ) : (
          <ol className="small">
            <li>
              터미널에서 <code>bash ~/Downloads/tail-cards-setup.sh</code>
            </li>
            <li>설치·로그인·브리지 실행을 알아서 하고, 끝나면 이 페이지가 자동으로 연결됩니다</li>
          </ol>
        )}
        <p className="muted small">
          {state.kind === 'offline'
            ? '이미 설치했다면 같은 파일을 다시 실행해도 됩니다(된 단계는 건너뜀). '
            : '이미 설치된 단계는 건너뜁니다. '}
          <button className="btn sm ghost" onClick={() => setOs(os === 'win' ? 'unix' : 'win')}>
            {os === 'win' ? 'macOS·Linux용 보기' : 'Windows용 보기'}
          </button>
          <button className="btn sm ghost" onClick={() => void onChange()}>
            다시 확인
          </button>
        </p>
      </div>

      <details>
        <summary className="muted small">직접 명령어로 설치하기 · 수동 연결 · 제거 방법</summary>
        {osToggle}
        <ol className="setup">
          <li>
            <b>Claude Code 설치 · 로그인</b>
            <span className="muted small"> — 이미 했다면 건너뛰기</span>
            <Copy text={os === 'win' ? 'npm.cmd install -g @anthropic-ai/claude-code' : 'npm install -g @anthropic-ai/claude-code'} />
            <Copy text={loginCmd} />
            <p className="muted small">
              Node.js가 필요합니다. 다른 설치 방법은{' '}
              <a href="https://code.claude.com/docs" target="_blank" rel="noreferrer">
                공식 문서 ↗
              </a>
            </p>
          </li>
          <li>
            <b>브리지 받아서 실행</b>
            <span className="muted small"> — 내 PC의 Claude Code와 이 페이지를 잇는 작은 프로그램 (127.0.0.1 전용, 도구 없이 텍스트만 생성)</span>
            <p className="muted small">{os === 'win' ? '명령 프롬프트(cmd)나 PowerShell을 열고 홈 폴더(C:\\Users\\<이름>)에서 두 줄을 차례로 실행:' : '터미널에서 두 줄을 차례로 실행:'}</p>
            <Copy text={downloadCmd} />
            <Copy text={rerun} />
            <p className="muted small">
              <a href={bridgeUrl} target="_blank" rel="noreferrer">
                브리지 코드 보기
              </a>
            </p>
          </li>
          <li>
            <b>터미널에 나온 연결 링크를 브라우저에서 열기</b>
            <span className="muted small">
              {' '}
              — 브리지가 켜지면 <code>…#/generate?bridge=<b>1a2b3c…</b>&amp;port=47321</code> 같은 링크가 나옵니다. 링크를 열거나, <code>bridge=</code> 뒤부터 <code>&amp;</code> 앞까지의 긴 코드를 아래에 붙여넣으세요.
            </span>
            <div className="row">
              <input className="grow" value={code} onChange={(e) => setCode(e.target.value.trim())} placeholder="연결 코드" />
              <button
                className="btn sm"
                disabled={!/^[0-9a-f]{32,}$/i.test(code)}
                onClick={async () => {
                  await saveBridge({ token: code, port: DEFAULT_PORT });
                  setCode('');
                  await onChange();
                }}
              >
                연결
              </button>
            </div>
          </li>
        </ol>
        {os === 'win' && (
          <div className="stack">
            <p className="muted small">
              <b>제거</b>: 아래를 실행한 뒤 작업 표시줄의 "Tail Cards Bridge" 창을 닫으세요.
            </p>
            <Copy text={'del "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Tail Cards Bridge.cmd" & rmdir /s /q "%LOCALAPPDATA%\\TailCards"'} />
          </div>
        )}
      </details>
    </section>
  );
}

function ImportPanel({ decks }: { decks: Deck[] }) {
  const [target, setTarget] = useState('new');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ text: string; link?: string; error?: boolean } | null>(null);
  const [drag, setDrag] = useState(false);

  async function importFiles(files: { name: string; text: string }[]) {
    const mds = files.filter((f) => /\.md$/i.test(f.name)).map((f) => ({ fileName: f.name, md: f.text }));
    if (!mds.length) return setMsg({ text: '.md 파일을 선택해 주세요.', error: true });
    try {
      if (target === 'new') {
        const title = name.trim() || mds[0].fileName.replace(/\s*\(카드형\)\s*\.md$|\.md$/i, '');
        const id = `user-${Date.now().toString(36)}`;
        const b = buildDeck(mds, { id, title, subject: title, description: '가져온 꼬리질문 카드', builtIn: false });
        if (!b.cards.length) throw new Error('카드(### Q…)를 찾지 못했습니다. 카드형 포맷인지 확인해 주세요.');
        await saveBundle(b);
        setMsg({ text: `새 덱 “${title}”: 챕터 ${b.chapters.length}개, 카드 ${b.cards.length}장`, link: href(['chapter', id, b.chapters[0].id]) });
      } else {
        const added = await addChaptersToDeck(target, mds);
        if (!added.length) throw new Error('카드(### Q…)를 찾지 못했습니다. 카드형 포맷인지 확인해 주세요.');
        const total = added.reduce((s, a) => s + a.cards, 0);
        setMsg({ text: `챕터 ${added.length}개, 카드 ${total}장을 추가했습니다 (같은 이름 챕터는 교체)`, link: href(['chapter', target, added[0].chapterId]) });
      }
    } catch (e) {
      setMsg({ text: String((e as Error).message ?? e), error: true });
    }
  }

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const files = await Promise.all([...e.dataTransfer.files].map(async (f) => ({ name: f.name, text: await f.text() })));
    await importFiles(files);
  };

  return (
    <div className="stack">
      <div className="grid2">
        <label className="field">
          <span>넣을 덱</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="new">+ 새 덱 만들기</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </label>
        {target === 'new' && (
          <label className="field">
            <span>새 덱 이름</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 운영체제" />
          </label>
        )}
      </div>
      <div
        className={`dropzone ${drag ? 'on' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => void onDrop(e)}
      >
        <p>
          <b>(카드형).md</b> 파일을 여기로 끌어다 놓거나
        </p>
        <button className="btn" onClick={() => void readFiles('.md,text/markdown', true).then(importFiles)}>
          파일 선택
        </button>
      </div>
      {msg && (
        <p className={`toast ${msg.error ? 'error' : ''}`}>
          {msg.text} {msg.link && <a href={msg.link}>바로 보기 →</a>}
        </p>
      )}
    </div>
  );
}
