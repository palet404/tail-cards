// 설치 파일을 로컬에서 만들어 보는 개발용 스크립트 (페이지의 "설치 파일 받기"와 같은 내용)
// 사용: node scripts/make-setup.ts <앱 주소> <출력 파일>
import { writeFileSync } from 'node:fs';
import { windowsSetup, unixSetup } from '../src/bridge/setup.ts';

const app = (process.argv[2] ?? 'http://localhost:5173/').replace(/\/?$/, '/');
const out = process.argv[3] ?? 'tail-cards-setup.cmd';
const bridge = new URL('bridge/tail-cards-bridge.mjs', app).href;
writeFileSync(out, out.endsWith('.sh') ? unixSetup(app, bridge) : windowsSetup(app, bridge));
console.log(`${out} (app=${app})`);
