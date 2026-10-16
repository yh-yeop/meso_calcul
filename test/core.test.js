'use strict';
// index.html 안의 <script id="meso-core"> 블록을 그대로 꺼내 Node에서 돌린다.
// 페이지는 파일 하나로 유지하면서(file:// 로 열어도 동작) 계산 로직만 검사하기 위한 방식.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCore() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const m = html.match(/<script id="meso-core">([\s\S]*?)<\/script>/);
  assert.ok(m, 'meso-core 블록이 있어야 한다');
  // 같은 realm에서 실행해야 deepEqual이 프로토타입 차이로 실패하지 않는다
  const mod = { exports: {} };
  vm.runInThisContext('(function(module){' + m[1] + '\n})', { filename: 'index.html#meso-core' })(mod);
  return mod.exports;
}
const M = loadCore();
const D = (y, m, d) => new Date(y, m - 1, d);
const base = () => ({ weekly: 20, monthly: 10, rate: 3, hours: 2, skipThu: true, have: 0, goal: 100, start: D(2026, 10, 12) /* 월 */ });

test('parseMeso: 원 단위, 한글 단위, 억 단위 숫자를 모두 억으로', () => {
  assert.equal(M.parseMeso('2,131,700,000'), 21.317);
  assert.equal(M.parseMeso('21억 3170만'), 21.317);
  assert.equal(M.parseMeso('21.317'), 21.317);
  assert.equal(M.parseMeso('5000만'), 0.5);
  assert.equal(M.parseMeso('글자'), null);
  assert.equal(M.parseMeso('Lv.289'), null);
});

test('parsePaste: maplescouter 캐릭터 목록(#N 블록) 형식', () => {
  const txt = `
#1제네시스 2차 해방
베라
호야시치
Lv.289 소마
57,101
주간수익
2,131,700,000
월간수익
665,000,000
🪙 12 / sole 1.51 / de 16
#2
베라
부캐이름
Lv.260 아델
주간수익
500,000,000
월간수익
0
`;
  const r = M.parsePaste(txt);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { name: '호야시치', weekly: 21.317, monthly: 6.65 });
  assert.deepEqual(r[1], { name: '부캐이름', weekly: 5, monthly: 0 });
});

test('parsePaste: 라벨-값 쌍만 있는 형식', () => {
  const r = M.parsePaste('주간수익\n1,000,000,000\n월간수익\n200,000,000\n주간 수익\n30억\n월간 수익\n0');
  assert.equal(r.length, 2);
  assert.equal(r[0].weekly, 10);
  assert.equal(r[0].monthly, 2);
  assert.equal(r[1].weekly, 30);
});

test('날짜 유틸: parseDate/toISO/addDays', () => {
  const d = M.parseDate('2026-02-28');
  assert.equal(M.toISO(d), '2026-02-28');
  assert.equal(M.toISO(M.addDays(d, 1)), '2026-03-01');
  assert.equal(M.toISO(M.addDays(d, -59)), '2025-12-31');
  assert.equal(M.parseDate(''), null);
  assert.equal(M.parseDate('2026-13-99'), null);
});

test('simulate: 주보는 목요일에, 월보는 1일에, 사냥은 매일(목요일 제외 옵션)', () => {
  const cfg = base(); // 2026-10-12 월요일
  const sim = M.simulate(cfg, 7);
  // 월~일: 목(10/15)에 주보 20, 1일 없음, 사냥 3*2=6 × (목요일 제외 6일) = 36
  assert.equal(sim.daily[6], 20 + 36);
  assert.equal(sim.daily[2], 18, '월화수 사냥만');
  assert.equal(sim.daily[3], 18 + 20, '목요일: 주보만, 사냥 없음');
  const cfg2 = Object.assign(base(), { skipThu: false, start: D(2026, 10, 29) }); // 목
  const sim2 = M.simulate(cfg2, 3);
  assert.equal(sim2.daily[0], 20 + 6, '시작일이 목요일이면 당일 주보 포함, 목요일 사냥 포함');
  assert.equal(sim2.daily[2], 20 + 6 + 6 + 6);
  const cfg3 = Object.assign(base(), { start: D(2026, 11, 1) }); // 일요일, 1일
  assert.equal(M.simulate(cfg3, 1).daily[0], 10 + 6, '1일에 월보');
});

test('simulate: 일회성 항목은 지정한 날에 한 번만, 음수는 지출', () => {
  const cfg = Object.assign(base(), { weekly: 0, monthly: 0, rate: 0, hours: 0, once: { 2: 50, 4: -20 } });
  const sim = M.simulate(cfg, 6);
  assert.deepEqual(sim.daily, [0, 0, 50, 50, 30, 30]);
  assert.ok(sim.pts.some((p) => p.kind === 'once' && p.y === 50));
});

test('simulate(light): 도달하면 바로 끊고 hitIndex 반환', () => {
  const cfg = Object.assign(base(), { goal: 30 });
  const light = M.simulate(cfg, 365, true);
  const full = M.simulate(cfg, 365);
  assert.equal(light.hitIndex, full.hitIndex);
  assert.equal(light.pts, null);
  assert.ok(full.daily[full.hitIndex] >= 30);
  assert.ok(full.hitIndex === 0 || full.daily[full.hitIndex - 1] < 30);
});

test('findGoal: 이미 달성 / 도달 불가 / 일수는 simulate와 일치', () => {
  assert.deepEqual(M.findGoal(Object.assign(base(), { have: 100 })), { days: 0 });
  assert.deepEqual(M.findGoal(Object.assign(base(), { weekly: 0, monthly: 0, hours: 0 })), { days: -1 });
  const cfg = base();
  const g = M.findGoal(cfg);
  const sim = M.simulate(cfg, g.days + 5);
  assert.equal(sim.hitIndex + 1, g.days);
  // 주보만 있으면 도달일은 목요일
  const w = Object.assign(base(), { monthly: 0, hours: 0, goal: 55 });
  const gw = M.findGoal(w);
  assert.equal(M.addDays(w.start, gw.days - 1).getDay(), 4);
  assert.equal(gw.days, 18, '10/15, 10/22, 10/29 세 번째 목요일');
});

test('findGoal: 정기 수입이 없어도 일회성 수입만으로 도달 가능', () => {
  const cfg = Object.assign(base(), { weekly: 0, monthly: 0, hours: 0, goal: 100, once: { 9: 100 } });
  assert.deepEqual(M.findGoal(cfg), { days: 10 });
  const cfg2 = Object.assign(base(), { weekly: 0, monthly: 0, hours: 0, goal: 100, once: { 9: -5 } });
  assert.deepEqual(M.findGoal(cfg2), { days: -1 }, '지출만 있으면 불가');
});

test('monthIncome: 주 4.348배, 사냥은 목요일 제외 6/7', () => {
  const inc = M.monthIncome(base());
  assert.ok(Math.abs(inc.weekly - 20 * 365.2425 / 12 / 7) < 1e-9);
  assert.equal(inc.monthly, 10);
  assert.ok(Math.abs(inc.hunt - 6 * 365.2425 / 12 * 6 / 7) < 1e-9);
  assert.ok(Math.abs(M.monthIncome(Object.assign(base(), { skipThu: false })).hunt - 6 * 365.2425 / 12) < 1e-9);
});

test('withCfg: 복사본에 키 하나만 바꾸고 once 같은 부가 필드도 유지', () => {
  const cfg = Object.assign(base(), { once: { 1: 5 } });
  const c = M.withCfg(cfg, 'hours', 4);
  assert.equal(c.hours, 4);
  assert.equal(cfg.hours, 2);
  assert.equal(c.once, cfg.once);
  assert.equal(c.start, cfg.start);
});

test('costFor1Day: 그만큼 올리면 하루가 당겨지고, 그보다 적으면 안 당겨진다', () => {
  const cfg = base();
  const baseDays = M.findGoal(cfg).days;
  for (const key of ['weekly', 'rate', 'hours']) {
    const v = M.costFor1Day(cfg, key, baseDays);
    assert.ok(v > 0, key);
    assert.ok(M.findGoal(M.withCfg(cfg, key, cfg[key] + v)).days <= baseDays - 1, key + ' 충분');
    assert.ok(M.findGoal(M.withCfg(cfg, key, cfg[key] + v * 0.999)).days > baseDays - 1, key + ' 모자람');
  }
  assert.equal(M.costFor1Day(cfg, 'weekly', 1), null, '하루 안에 도달하면 당길 게 없음');
});

test('포맷: fmtEok / fmtShort / fmtFine', () => {
  assert.equal(M.fmtEok(12.345), '12.3억');
  assert.equal(M.fmtEok(1234.5), '1,235억');
  assert.equal(M.fmtEok(12345), '1조 2,345억');
  assert.equal(M.fmtEok(-3), '-3억');
  assert.equal(M.fmtEok(NaN), '—');
  assert.equal(M.fmtShort(12345), '1.2조');
  assert.equal(M.fmtFine(0.05), '500만');
  assert.equal(M.fmtFine(1.234), '1.23억');
});

test('b64e/b64d: 한글 포함 왕복, URL-safe', () => {
  const src = JSON.stringify({ r: [['본캐', 34.8, 13.3]], goal: '781.25' });
  const enc = M.b64e(src);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(enc));
  assert.equal(M.b64d(enc), src);
});
