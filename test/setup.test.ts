import { describe, expect, it } from 'vitest';
import { unixSetup, windowsSetup } from '../src/bridge/setup.ts';

describe('설치 파일', () => {
  const win = windowsSetup('https://me.github.io/tail-cards/', 'https://me.github.io/tail-cards/bridge/tail-cards-bridge.mjs');

  it('Windows: CRLF, 주소 포함, goto 대상 라벨이 모두 존재', () => {
    expect(win.includes('\r\n')).toBe(true);
    expect(win.replace(/\r\n/g, '').includes('\n')).toBe(false);
    expect(win).toContain('set "APP=https://me.github.io/tail-cards/"');
    const labels = new Set([...win.matchAll(/^:(\w+)/gm)].map((m) => m[1]));
    const gotos = [...win.matchAll(/goto (\w+)/g)].map((m) => m[1]);
    for (const g of gotos) expect(labels.has(g), `라벨 없음: ${g}`).toBe(true);
  });

  it('Windows: 블록 괄호 안에 echo가 없음 (cmd 괄호 파싱 오류 방지)', () => {
    for (const line of win.split('\r\n')) if (/^echo /.test(line)) expect(line).not.toMatch(/[()]/);
  });

  it('주소의 cmd 특수문자는 제거', () => {
    expect(windowsSetup('http://x/?a=1&b=%2', 'http://y')).toContain('set "APP=http://x/?a=1b=2"');
  });

  it('Unix: 주소 포함', () => {
    expect(unixSetup('https://me.github.io/t/', 'https://b')).toContain("APP='https://me.github.io/t/'");
  });
});
