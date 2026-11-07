# Tail Cards — 꼬리질문 면접 카드

전공 면접을 **면접관의 꼬리질문 체인**으로 연습하는 Anki식 카드 학습 웹앱입니다.
카드는 [CS-Tutor](#cs-tutor-카드형-포맷)의 `card-interview` 포맷을 그대로 씁니다: 질문 앞면 / 두괄식·키워드·풀어 말하기·**왜 이렇게 답하나**·함정 뒷면 / `꼬리 →` 연결.

- **기본 덱**: 자료구조(Data Structures & Algorithms in Python) 36개 챕터, 227장
- **학습**: 앞면 질문 → 🎙️ 말로(한국어 음성 인식) 또는 타이핑으로 30초 답변 → 뒷면에서 **키워드 자동 체크** → 자기 평가(FSRS 간격 반복)
- **체인 모드**: 한 카드를 답하면 면접관이 이어 물을 꼬리질문을 골라 계속 파고들기. 챕터 연결도(mermaid)에서 숙련도 색 확인, 노드를 눌러 그 질문부터 시작
- **노트로 카드 만들기 (Claude 구독, API 키 불필요)**: "카드 만들기" 화면에 노트를 붙여넣고 버튼을 누르면, 내 PC의 Claude Code가 [`tail-cards` 규칙](public/skill/tail-cards/SKILL.md)으로 카드를 만들어 바로 덱에 넣습니다
  노트 → (교재 원문이면 7단계/방법론형 개념 노트로 정리) → 꼬리질문 설계 → 카드 뒷면 작성 (CS-Tutor `card-interview` 로직을 과목 무관하게 일반화)
- **Obsidian 호환**: 카드형 `.md` 가져오기/내보내기 (왕복해도 원문과 바이트 단위로 동일)
- **서버 없음**: 정적 사이트(GitHub Pages) + PWA(홈 화면 설치, 오프라인 학습). 학습 기록은 브라우저 IndexedDB에만 저장되고, 설정에서 JSON으로 백업/복원

## 사용

```bash
npm install
npm run dev
```

- 음성 답변은 Web Speech API를 쓰므로 Chrome·Edge·Safari에서 동작합니다(Firefox는 타이핑만).

### 카드 만들기 (로컬 브리지 + Claude Code)

외부 웹앱이 claude.ai 구독 계정으로 직접 로그인해 Claude를 호출하는 것은 Anthropic이 허용하지 않습니다. 그래서 페이지는 **내 PC에서 도는 작은 브리지**를 거쳐, 내가 로그인한 Claude Code CLI로 생성합니다.

```
페이지(노트 입력) ──HTTP, 페어링 토큰──▶ 브리지(127.0.0.1:47321) ──▶ claude -p (도구 없음) ──▶ 카드 .md ──▶ 덱에 자동 저장
```

**보통은 페이지의 "설치 파일 받기" 하나로 끝납니다.** 받은 `tail-cards-setup.cmd`(Windows)를 더블클릭하면 Node.js·Claude Code 설치, 구독 계정 로그인, 브리지 다운로드, Windows 로그인 시 자동 실행 등록, 즉시 실행까지 하고, 페이지는 브리지에 **자동으로 연결**됩니다(브리지는 `--app`으로 허용한 주소의 페이지에만 토큰을 줍니다). macOS·Linux는 `bash tail-cards-setup.sh`(자동 실행 등록 없음).
제거(Windows): 시작 프로그램의 `Tail Cards Bridge.cmd`와 `%LOCALAPPDATA%\TailCards` 삭제.

직접 설치하려면:

1. Claude Code CLI 설치 · 구독 계정 로그인 (Windows PowerShell은 실행 정책 때문에 `.cmd`를 붙입니다)
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
   ```bash
   claude auth login
   ```
2. 브리지 실행 — "카드 만들기" 화면에 내 배포 주소가 들어간 다운로드+실행 명령이 있습니다. 이 레포에서는:
   ```bash
   npm run bridge -- --app http://localhost:5173/
   ```
3. 페이지가 자동으로 연결됩니다. 안 되면 터미널에 나온 연결 링크를 브라우저에서 여세요 (토큰은 `~/.tail-cards-bridge.json`에 저장)
4. 노트 붙여넣기 → **카드 만들기** (보통 1~3분) → 덱에 저장됨

브리지 안전장치: `127.0.0.1`에서만 열림 · 페어링 토큰 없는 요청 거부 · Claude는 `--tools ""`로 도구 없이 텍스트만 생성(파일·명령 접근 없음) · 한 번에 한 작업.
Claude Code를 직접 쓰는 경우 같은 규칙을 스킬로 설치해 `/tail-cards "노트.md"`로 만들고, 결과 `.md`를 "이미 만든 (카드형).md 가져오기"로 넣을 수도 있습니다.

## 배포 (GitHub Pages)

1. GitHub에 레포를 만들고 push
2. Settings → Pages → Source: **GitHub Actions**
3. `main`에 push하면 `.github/workflows/deploy.yml`이 테스트·빌드 후 `https://<user>.github.io/<repo>/`에 배포

## 기본 덱 갱신 (CS-Tutor에서)

```bash
node scripts/import-cs-tutor.ts "<CS_Tutor>/knowledge_base/tail_interview"
```

`tail_interview/<subject>/*.md` 폴더마다 `public/decks/<subject>.json` 덱이 만들어집니다(`_`로 시작하는 파일 제외). 앱은 다음 실행 때 바뀐 덱을 자동으로 갱신하고, 학습 기록은 카드 ID(`^xxx-qNN` 블록 ID)로 유지됩니다.

## CS-Tutor 카드형 포맷

```markdown
## 1. 섹션

### Q1. 맵(Map)이 무엇인지 설명해 주세요.
> [!answer]- 뒷면
> - **두괄식**: 맵은 고유한 키를 값에 연결하는 **추상 자료형**입니다.
> - **키워드**: `고유 키` / `값은 중복 가능` / `ADT → 해시 테이블 or 균형 BST로 구현`
> - **풀어 말하기**: …
> - **왜 이렇게 답하나**: …
>   → [[concepts/data_structure/10.1_10.2 맵과 해시 테이블#맵(ADT)]]
> - **함정**: …
> - **꼬리 →** [[#^maphash-q02|Q2]], [[#^maphash-q13|Q13]]

^maphash-q01
```

- `## 0. 흐름 한 줄`의 코드블록 = 흐름, ` ```mermaid ` = 연결도
- `## ✍️ 직접 채울 카드` 아래 카드는 학습 대상에서 빠지고 챕터 화면에 힌트와 함께 표시
- `→ 📌 [[…]]` = 노트(concept)에 없어 보조 자료로 근거를 댄 카드

## 구조

```
src/core/   model · parse-card-md · render-card-md · srs(ts-fsrs) · keyword-match
src/db/     Dexie(IndexedDB) 저장소, 기본 덱 시드
src/bridge/ 브리지 클라이언트(페어링·상태·생성) · 프롬프트(SKILL.md + 실행 규칙)
src/ui/     Home · Study · ChapterView · Generate(노트 입력 + 브리지 + 가져오기) · Settings
public/skill/tail-cards/SKILL.md          카드 생성 규칙 (브리지 프롬프트와 Claude Code 스킬의 단일 원본)
public/bridge/tail-cards-bridge.mjs       로컬 브리지 (의존성 없는 Node 스크립트)
scripts/    import-cs-tutor.ts
test/       파서 왕복(36개 파일)·SRS·키워드·생성 결과 테스트
```

```bash
npm test         # vitest
npm run build    # 타입 체크 + 빌드
```
