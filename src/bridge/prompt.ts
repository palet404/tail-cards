// 브리지(Claude Code -p)에 보낼 프롬프트. 규칙 본문은 배포된 SKILL.md를 그대로 쓴다(단일 원본).

export interface CardRequest {
  subject: string;
  title: string;
  note: string;
  raw: boolean;
  tone?: string;
}

export async function loadSkill(): Promise<string> {
  const r = await fetch(`${import.meta.env.BASE_URL}skill/tail-cards/SKILL.md`);
  if (!r.ok) throw new Error('SKILL.md를 불러오지 못했습니다');
  return stripFrontmatter(await r.text());
}

export function stripFrontmatter(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
}

const RUN_RULES = `## 이번 실행 방식 (Tail Cards 웹앱에서 호출, 위 규칙보다 우선)
- 비대화형 실행이다. 질문하지 말고 주어진 정보로 끝까지 완성한다. 도구·파일 접근은 없다.
- 파일을 저장하지 말고, **최종 응답으로 카드 파일(.md) 내용 전체만** 출력한다. 앞뒤 설명 문장, 전체를 감싸는 코드펜스 금지.
- 근거 링크의 노트 파일명은 <노트 이름>으로 주어진 값을 쓴다.
- "원문 여부: 예"이면 2단계 개념 정리를 먼저 머릿속으로 수행하고 그 헤딩(## 배경 … 또는 ## 문제 설정 …)을 근거 링크로 쓴다. 출력은 카드 파일만.
- 6단계 보고는 하지 않는다.`;

export function buildPrompt(skill: string, req: CardRequest) {
  const system = `${skill}\n\n${RUN_RULES}`;
  const prompt = [
    `과목: ${req.subject}`,
    `단원 제목: ${req.title}`,
    `노트 이름: ${req.title}`,
    `원문 여부: ${req.raw ? '예 (교재 원문/거친 메모 → 개념 정리부터)' : '아니오 (정리된 노트)'}`,
    req.tone ? `\n<말투 샘플>\n${req.tone}\n</말투 샘플>` : '',
    `\n<노트>\n${req.note}\n</노트>`,
  ]
    .filter(Boolean)
    .join('\n');
  return { system, prompt };
}

/** 모델이 전체를 코드펜스로 감싸거나 앞에 설명을 붙인 경우 정리 */
export function cleanOutput(md: string): string {
  let s = md.trim();
  const fenced = s.match(/^````?(?:markdown|md)?\n([\s\S]*?)\n````?$/);
  if (fenced) s = fenced[1];
  const start = s.search(/^(### source|## 0\.|## 1\.|### Q1\.)/m);
  if (start > 0) s = s.slice(start);
  return s.trimEnd() + '\n';
}
