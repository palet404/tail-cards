import { lazy, Suspense, useEffect, useState } from 'react';
import { seedBuiltInDecks } from './db/db.ts';
import { ChapterView } from './ui/ChapterView.tsx';

// 카드 만들기 화면은 필요할 때만 불러온다
const Generate = lazy(() => import('./ui/Generate.tsx').then((m) => ({ default: m.Generate })));
import { Home } from './ui/Home.tsx';
import { href, useRoute } from './ui/route.ts';
import { Settings } from './ui/Settings.tsx';
import { Study } from './ui/Study.tsx';

export function App() {
  const route = useRoute();
  const [ready, setReady] = useState(false);
  const [seedErr, setSeedErr] = useState('');

  useEffect(() => {
    seedBuiltInDecks()
      .catch((e) => setSeedErr(String(e?.message ?? e)))
      .finally(() => setReady(true));
  }, []);

  const [page, a, b] = route.path;
  const key = location.hash;

  let body;
  if (!ready) body = <p className="muted">기본 덱 준비 중…</p>;
  else if (page === 'study' && a)
    body = (
      <Study
        key={key}
        deckId={a}
        mode={(route.query.get('mode') as 'srs' | 'chain' | 'all') ?? 'srs'}
        chapterId={route.query.get('chapter') ?? undefined}
        startCard={route.query.get('card') ?? undefined}
      />
    );
  else if (page === 'chapter' && a && b) body = <ChapterView key={key} deckId={a} chapterId={b} />;
  else if (page === 'generate')
    body = (
      <Suspense fallback={<p className="muted">불러오는 중…</p>}>
        <Generate query={route.query} />
      </Suspense>
    );
  else if (page === 'settings') body = <Settings />;
  else body = <Home />;

  const nav = (p: string, label: string) => (
    <a href={href(p ? [p] : [])} className={(page ?? '') === p ? 'on' : ''}>
      {label}
    </a>
  );

  return (
    <>
      <header className="topbar">
        <a className="brand" href={href([])}>
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={26} height={26} />
          <span>Tail Cards</span>
        </a>
        <nav>
          {nav('', '덱')}
          {nav('generate', '카드 만들기')}
          {nav('settings', '설정')}
        </nav>
      </header>
      <main className="container">
        {seedErr && <p className="toast error">기본 덱을 불러오지 못했습니다: {seedErr}</p>}
        {body}
      </main>
      <footer className="foot muted small">
        꼬리질문 카드 포맷: CS-Tutor <code>card-interview</code> · 학습 기록은 이 브라우저에만 저장됩니다 (설정 → JSON 내보내기로 백업)
      </footer>
    </>
  );
}
