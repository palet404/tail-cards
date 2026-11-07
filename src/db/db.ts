import Dexie, { type EntityTable } from 'dexie';
import type { Card, Chapter, Deck, DeckBundle } from '../core/model.ts';
import type { SrsState } from '../core/srs.ts';
import { parseChapterMd } from '../core/parse-card-md.ts';

export interface ReviewLog {
  id?: number;
  cardId: string;
  deckId: string;
  grade: number;
  at: number;
  answer?: string;
  keywordRatio?: number;
}

export interface Setting {
  key: string;
  value: unknown;
}

class TailDB extends Dexie {
  decks!: EntityTable<Deck, 'id'>;
  chapters!: EntityTable<Chapter, 'id'>;
  cards!: EntityTable<Card, 'id'>;
  srs!: EntityTable<SrsState, 'cardId'>;
  logs!: EntityTable<ReviewLog, 'id'>;
  settings!: EntityTable<Setting, 'key'>;

  constructor() {
    super('tail-cards');
    this.version(1).stores({
      decks: 'id',
      chapters: 'id, deckId, order',
      cards: 'id, deckId, chapterId',
      srs: 'cardId, deckId, due',
      logs: '++id, cardId, deckId, at',
      settings: 'key',
    });
  }
}

export const db = new TailDB();

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await db.settings.get(key);
  return (s?.value as T) ?? fallback;
}

export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value });
}

/** 덱 번들 저장. 같은 id 덱이 있으면 카드·챕터를 교체하되 학습 기록(srs)은 남긴다 */
export async function saveBundle(b: DeckBundle) {
  await db.transaction('rw', db.decks, db.chapters, db.cards, async () => {
    await db.chapters.where('deckId').equals(b.deck.id).delete();
    await db.cards.where('deckId').equals(b.deck.id).delete();
    await db.decks.put(b.deck);
    await db.chapters.bulkPut(b.chapters);
    await db.cards.bulkPut(b.cards);
  });
}

export async function loadBundle(deckId: string): Promise<DeckBundle | undefined> {
  const deck = await db.decks.get(deckId);
  if (!deck) return undefined;
  const chapters = await db.chapters.where('deckId').equals(deckId).sortBy('order');
  const cards = await db.cards.where('deckId').equals(deckId).toArray();
  cards.sort((a, b) => {
    const ca = chapters.findIndex((c) => c.id === a.chapterId);
    const cb = chapters.findIndex((c) => c.id === b.chapterId);
    return ca - cb || a.order - b.order;
  });
  return { format: 'tail-cards/deck@1', deck, chapters, cards };
}

/** 카드형 .md 파일들을 기존 덱에 챕터로 추가 (같은 파일명 챕터는 교체, 학습 기록은 카드 ID로 유지) */
export async function addChaptersToDeck(deckId: string, files: { fileName: string; md: string }[]) {
  const b = await loadBundle(deckId);
  if (!b) throw new Error('덱을 찾을 수 없습니다');
  let chapters = [...b.chapters];
  let cards = [...b.cards];
  const added: { chapterId: string; cards: number }[] = [];
  for (const f of files) {
    const order = chapters.find((c) => c.fileName === f.fileName)?.order ?? chapters.length;
    const { chapter, cards: cs } = parseChapterMd(f.md, { deckId, fileName: f.fileName, order });
    if (!cs.length) continue;
    const others = cards.filter((c) => c.chapterId !== chapter.id);
    const taken = new Set(others.map((c) => c.id));
    const rename = new Map<string, string>();
    for (const c of cs) {
      if (taken.has(c.id)) {
        rename.set(c.id, `${chapter.id}-${c.id}`);
        c.id = `${chapter.id}-${c.id}`;
      }
    }
    chapter.blocks = chapter.blocks.map((bl) => (bl.type === 'card' && rename.has(bl.cardId) ? { ...bl, cardId: rename.get(bl.cardId)! } : bl));
    chapters = [...chapters.filter((c) => c.id !== chapter.id), chapter].sort((x, y) => x.order - y.order);
    cards = [...others, ...cs];
    added.push({ chapterId: chapter.id, cards: cs.length });
  }
  await saveBundle({ ...b, chapters, cards });
  return added;
}

export async function deleteDeck(deckId: string) {
  await db.transaction('rw', [db.decks, db.chapters, db.cards, db.srs, db.logs], async () => {
    await db.decks.delete(deckId);
    await db.chapters.where('deckId').equals(deckId).delete();
    await db.cards.where('deckId').equals(deckId).delete();
    await db.srs.where('deckId').equals(deckId).delete();
    await db.logs.where('deckId').equals(deckId).delete();
  });
}

/** 기본 덱(public/decks) 시드. 버전이 바뀌면(카드 수·내용 해시) 갱신 */
export async function seedBuiltInDecks() {
  const base = import.meta.env.BASE_URL;
  let index: { id: string; file: string; cards: number }[] = [];
  try {
    index = await (await fetch(`${base}decks/index.json`)).json();
  } catch {
    return;
  }
  for (const entry of index) {
    const seededKey = `seed:${entry.id}`;
    const res = await fetch(`${base}decks/${entry.file}`);
    const text = await res.text();
    const sig = `${text.length}:${entry.cards}`;
    if ((await getSetting(seededKey, '')) === sig) continue;
    const bundle = JSON.parse(text) as DeckBundle;
    await saveBundle(bundle);
    await setSetting(seededKey, sig);
  }
}
