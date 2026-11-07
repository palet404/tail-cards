import { useEffect, useState } from 'react';
import type { DeckBundle } from '../core/model.ts';
import type { SrsState } from '../core/srs.ts';
import { db, deleteDeck, getSetting, loadBundle, saveBundle, setSetting } from '../db/db.ts';
import { useDecks } from './data.ts';
import { downloadText, readFiles } from './download.ts';
import { href } from './route.ts';

type ExportBundle = DeckBundle & { srs?: SrsState[] };

export function Settings() {
  const { decks, reload } = useDecks();
  const [perDay, setPerDay] = useState(20);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    void getSetting('newPerDay', 20).then(setPerDay);
  }, []);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(''), 4000);
  };

  async function exportDeck(deckId: string) {
    const b = await loadBundle(deckId);
    if (!b) return;
    const srs = await db.srs.where('deckId').equals(deckId).toArray();
    const out: ExportBundle = { ...b, srs };
    downloadText(`${b.deck.title}.tailcards.json`, JSON.stringify(out), 'application/json');
  }

  async function importJson() {
    const [f] = await readFiles('.json,application/json', false);
    if (!f) return;
    try {
      const b = JSON.parse(f.text) as ExportBundle;
      if (b.format !== 'tail-cards/deck@1') throw new Error('형식이 다릅니다');
      await saveBundle(b);
      if (b.srs?.length) {
        await db.srs.bulkPut(
          b.srs.map((s) => ({
            ...s,
            due: new Date(s.due),
            last_review: s.last_review ? new Date(s.last_review) : undefined,
          })),
        );
      }
      await reload();
      flash(`“${b.deck.title}” 덱 복원 (학습 기록 ${b.srs?.length ?? 0}건)`);
    } catch (e) {
      flash(`가져오기 실패: ${(e as Error).message}`);
    }
  }

  async function resetProgress(deckId: string) {
    if (!confirm('이 덱의 학습 기록을 모두 지울까요? 되돌릴 수 없습니다.')) return;
    await db.srs.where('deckId').equals(deckId).delete();
    await db.logs.where('deckId').equals(deckId).delete();
    await reload();
    flash('학습 기록을 지웠습니다');
  }

  async function removeDeck(deckId: string, title: string) {
    if (!confirm(`“${title}” 덱과 학습 기록을 삭제할까요? 되돌릴 수 없습니다. (먼저 JSON 내보내기를 권장)`)) return;
    await deleteDeck(deckId);
    await reload();
    flash('삭제했습니다');
  }

  return (
    <div className="stack-lg">
      <h1 className="page-title">설정</h1>
      {msg && <p className="toast">{msg}</p>}

      <section className="panel">
        <h2>학습</h2>
        <label className="field">
          <span>하루 새 카드 수</span>
          <input
            type="number"
            min={0}
            max={500}
            value={perDay}
            onChange={(e) => {
              const v = Number(e.target.value);
              setPerDay(v);
              void setSetting('newPerDay', v);
            }}
          />
        </label>
      </section>

      <section className="panel">
        <h2>백업 · 가져오기</h2>
        <div className="row">
          <button className="btn" onClick={() => void importJson()}>
            덱 백업(.json) 복원
          </button>
          <a className="btn ghost" href={href(['generate'])}>
            카드형 .md 가져오기 →
          </a>
        </div>
        <p className="muted small">학습 기록은 이 브라우저에만 저장됩니다. 다른 기기로 옮기거나 브라우저 데이터를 지우기 전에 아래에서 JSON으로 내보내 두세요.</p>
      </section>

      <section className="panel">
        <h2>덱 관리</h2>
        {!decks && <p className="muted">불러오는 중…</p>}
        <ul className="deck-admin">
          {decks?.map(({ bundle, srs }) => (
            <li key={bundle.deck.id}>
              <div>
                <b>{bundle.deck.title}</b>
                <span className="muted small">
                  {' '}
                  · 카드 {bundle.cards.length}장 · 학습 기록 {srs.length}건{bundle.deck.builtIn ? ' · 기본 덱' : ''}
                </span>
              </div>
              <div className="row">
                <button className="btn sm" onClick={() => void exportDeck(bundle.deck.id)}>
                  JSON 내보내기
                </button>
                <button className="btn sm ghost" onClick={() => void resetProgress(bundle.deck.id)}>
                  기록 초기화
                </button>
                {!bundle.deck.builtIn && (
                  <button className="btn sm danger" onClick={() => void removeDeck(bundle.deck.id, bundle.deck.title)}>
                    삭제
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
