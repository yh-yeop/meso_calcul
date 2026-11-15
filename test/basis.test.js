'use strict';
// basis.js("계산 기준" 접는 칸)의 순수 함수: 숫자를 bosses.js · core.js 에서 읽는지, 고친 가격 · 계산기 가정이 맞게 붙는지.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Basis = require('../basis.js');
const Core = require('../core.js');

function bosses() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'bosses.js'), 'utf8'), ctx);
  return ctx.window.MESO_BOSSES;
}
const text = html => html.replace(/<[^>]+>/g, '');

test('보스 기준: 가격 기준일 · 출처 · 주간 한도 · 월드 한도를 bosses.js 에서 읽음', () => {
  const B = bosses();
  const t = text(Basis.html({ bosses: B, over: 0 }));
  assert.ok(t.includes(B.version.replace(/-/g, '.')));
  assert.ok(t.includes('출처:'));
  assert.ok(t.includes('주 ' + B.weeklyLimit + '회'));
  assert.ok(t.includes('주 ' + B.worldLimit + '개'));
  assert.ok(t.includes('소수점 아래는 버림'));
  assert.ok(t.includes('목요일 0시') && t.includes('매월 1일'));
  assert.ok(t.includes('익스트림은 고른 보스만'));
  assert.ok(!t.includes('고친 가격'), '고친 가격이 없으면 그 줄은 안 나옴');
  assert.ok(!t.includes('목표 도달일'), '캐릭터 화면엔 계산기 가정이 없음');
});

test('값을 바꾸면 문장도 바뀜 — 화면에 숫자를 박지 않음', () => {
  const B = Object.assign({}, bosses(), { version: '2030-01-02', weeklyLimit: 14, worldLimit: 120, source: '' });
  const t = text(Basis.html({ bosses: B, over: 0 }));
  assert.ok(t.includes('2030.01.02'));
  assert.ok(t.includes('주 14회') && t.includes('주 14개까지'));
  assert.ok(t.includes('주 120개'));
  assert.ok(!t.includes('출처:'), '출처가 비면 출처 줄 없음');
});

test('⚙에서 고친 가격이 있으면 개수와 설정 링크', () => {
  const B = bosses();
  const h = Basis.html({ bosses: B, over: 3 });
  assert.ok(h.includes('href="#settings"'));
  assert.ok(text(h).includes('고친 가격 3개'));
  assert.equal(Basis.summary({ bosses: B, over: 3 }), '결정석 ' + B.version.replace(/-/g, '.') + ', 고친 가격 3개');
  assert.equal(Basis.summary({ bosses: B, over: 0 }), '결정석 ' + B.version.replace(/-/g, '.'));
});

test('계산기 화면: core.js 상수로 도달일 가정을 앞에 붙임', () => {
  const t = text(Basis.html({ bosses: bosses(), over: 0, core: Core }));
  assert.ok(t.indexOf('목표 도달일') < t.indexOf('보스 수익'));
  assert.ok(t.includes('최대 ' + Core.MAX_DAYS + '일'));
  assert.ok(t.includes(String(+Core.WEEK_PER_MONTH.toFixed(2)) + '주'));
  assert.ok(t.includes(String(+Core.DAYS_PER_MONTH.toFixed(2)) + '일'));
  assert.ok(t.includes('주보 건너뛸 주') && t.includes('목요일은 0'));
  assert.ok(t.includes('정기 지출은 매주 항목은 목요일, 매월 항목은 1일'));
});

test('출처 같은 bosses.js 문자열도 이스케이프', () => {
  const B = Object.assign({}, bosses(), { source: '<script>x</script>', version: '2026-10-22' });
  const h = Basis.html({ bosses: B, over: 0 });
  assert.ok(!h.includes('<script>'));
  assert.ok(h.includes('&lt;script&gt;'));
});
