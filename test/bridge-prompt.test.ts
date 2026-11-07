import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPrompt, cleanOutput, stripFrontmatter } from '../src/bridge/prompt.ts';
import { buildDeck } from '../src/core/parse-card-md.ts';
import { keywords, why } from '../src/core/model.ts';

const SKILL = readFileSync(join(import.meta.dirname, '..', 'public', 'skill', 'tail-cards', 'SKILL.md'), 'utf8');

describe('브리지 프롬프트', () => {
  it('frontmatter 제거, 실행 규칙 추가, 노트 포함', () => {
    const skill = stripFrontmatter(SKILL);
    expect(skill.startsWith('# Tail Cards')).toBe(true);
    const { system, prompt } = buildPrompt(skill, { subject: '컴구', title: '3.3 곱셈', note: '본문', raw: true });
    expect(system).toContain('이번 실행 방식');
    expect(prompt).toContain('<노트>\n본문\n</노트>');
    expect(prompt).toContain('원문 여부: 예');
  });

  it('출력 정리: 코드펜스·앞 설명 제거', () => {
    expect(cleanOutput('```markdown\n### source\nx\n```')).toBe('### source\nx\n');
    expect(cleanOutput('다음은 카드입니다.\n\n### source\nx')).toBe('### source\nx\n');
  });
});

describe('SKILL.md 출력 형식 예시가 앱 파서와 맞는다', () => {
  const example = SKILL.replace(/\r\n?/g, '\n').match(/````markdown\n([\s\S]*?)\n````/)![1];
  const deck = buildDeck([{ fileName: '예시 (카드형).md', md: example }], {
    id: 'sk', title: 't', subject: 's', description: '', builtIn: false,
  });
  it('카드 2장(직접 채울 카드 1), 필드·흐름·mermaid 인식', () => {
    expect(deck.cards).toHaveLength(2);
    expect(deck.cards[1].draft).toBe(true);
    expect(keywords(deck.cards[0])).toHaveLength(3);
    expect(why(deck.cards[0])).toContain('→ [[');
    expect(deck.chapters[0].flow).toContain('→');
    expect(deck.chapters[0].mermaid).toContain('flowchart LR');
  });
});
