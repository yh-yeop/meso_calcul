'use strict';
// 계산기 순수 로직(core.js)을 Node에서 그대로 돌린다. 브라우저에선 같은 파일을 <script src>로 씀.
const test = require('node:test');
const assert = require('node:assert/strict');

const M = require('../core.js');
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

test('diagnosePaste: 못 찾았을 때 어떤 단서를 봤는지 알려줌', () => {
  const empty = M.diagnosePaste('   \n\n');
  assert.equal(empty.lines, 0);
  assert.deepEqual(empty.hints, ['빈 텍스트']);

  // 라벨 자체가 없음 (다른 영역을 긁음)
  const none = M.diagnosePaste('호야시치\nLv.289 소마\n57,101\n12,345');
  assert.equal(none.weeklyLabels, 0);
  assert.equal(none.numbers, 2);
  assert.equal(none.levelLines, 1);
  assert.match(none.hints[0], /라벨이 없음/);
  assert.match(none.hints[0], /숫자 줄 2개/);

  // 라벨은 있는데 값이 같은 줄에 붙어 있어서 못 읽음
  const inline = M.diagnosePaste('#1\n주간수익: 2,131,700,000\n월간수익: 665,000,000');
  assert.equal(inline.blocks, 1);
  assert.equal(inline.weeklyLabels, 1);
  assert.equal(inline.weeklyValues, 0);
  assert.equal(inline.monthlyValues, 0);
  assert.match(inline.hints[0], /'주간수익' 라벨 1개 뒤 3줄 안에서 숫자를 못 읽음/);
  assert.match(inline.hints[1], /'월간수익' 라벨 1개/);
  assert.match(inline.summary, /#N 블록 1개 · '주간수익' 1개\(값 0\) · '월간수익' 1개\(값 0\)/);
  assert.deepEqual(M.parsePaste('#1\n주간수익: 2,131,700,000\n월간수익: 665,000,000'), [], '진단 대상과 일치');

  // 주간만 긁어서 쌍을 못 만듦
  const half = M.diagnosePaste('주간수익\n1,000,000,000\n주간수익\n500,000,000');
  assert.equal(half.weeklyValues, 2);
  assert.equal(half.monthlyLabels, 0);
  assert.match(half.hints[0], /'월간수익' 라벨이 없어/);

  // 블록은 있는데 수익이 전부 0
  const zero = M.diagnosePaste('#1\n베라\n이름\nLv.200 x\n주간수익\n0\n월간수익\n0');
  assert.equal(M.parsePaste('#1\n베라\n이름\nLv.200 x\n주간수익\n0\n월간수익\n0').length, 0);
  assert.match(zero.hints[0], /수익이 전부 0/);

  // 정상 텍스트에는 힌트가 없음
  const ok = M.diagnosePaste('#1\n베라\n이름\nLv.200 x\n주간수익\n1,000,000,000\n월간수익\n0');
  assert.equal(ok.weeklyValues, 1);
  assert.equal(ok.monthlyValues, 1);
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

test('simulate: skipWeeks 에 든 목요일은 주보가 0, 사냥·월보는 그대로', () => {
  const cfg = Object.assign(base(), { skipWeeks: { 3: true } }); // 10/15 목
  const sim = M.simulate(cfg, 14);
  assert.equal(sim.daily[3], 18, '건너뛴 목요일: 주보 없음, 사냥도 없음(skipThu)');
  assert.equal(sim.daily[10], 18 + 6 * 6 + 20, '다음 목요일(10/22)은 정상');
  assert.ok(!sim.pts.some((p) => p.kind === 'weekly' && p.x === 3));
  assert.ok(sim.pts.some((p) => p.kind === 'weekly' && p.x === 10));
  // 목요일이 아닌 날을 넣어도 영향 없음
  const other = Object.assign(base(), { skipWeeks: { 2: true } });
  assert.deepEqual(M.simulate(other, 7).daily, M.simulate(base(), 7).daily);
});

test('findGoal: 주보만 있을 때 한 주 건너뛰면 정확히 7일 밀림', () => {
  const w = Object.assign(base(), { monthly: 0, hours: 0, goal: 55 });
  assert.equal(M.findGoal(w).days, 18);
  assert.equal(M.findGoal(Object.assign({}, w, { skipWeeks: { 10: true } })).days, 25);
  assert.equal(M.findGoal(Object.assign({}, w, { skipWeeks: { 3: true, 10: true } })).days, 32);
  // 도달 뒤의 목요일을 건너뛰는 건 영향 없음
  assert.equal(M.findGoal(Object.assign({}, w, { skipWeeks: { 24: true } })).days, 18);
});

test('nextThursdays / skipOffsets: 시작일 포함 다가오는 목요일, ISO → dayOffset', () => {
  const t = M.nextThursdays(D(2026, 10, 12), 3).map(M.toISO); // 월
  assert.deepEqual(t, ['2026-10-15', '2026-10-22', '2026-10-29']);
  assert.equal(M.toISO(M.nextThursdays(D(2026, 10, 15), 1)[0]), '2026-10-15', '시작일이 목요일이면 당일');
  assert.equal(M.toISO(M.nextThursdays(D(2026, 10, 16), 1)[0]), '2026-10-22', '금요일 시작이면 다음 주');
  const start = D(2026, 10, 12);
  assert.deepEqual(M.skipOffsets(start, ['2026-10-15', '2026-10-29', '2026-10-01', 'bad']), { 3: true, 17: true });
  assert.equal(M.skipOffsets(start, []), null);
  assert.equal(M.skipOffsets(start, ['2026-10-08']), null, '시작일 이전만 있으면 null');
});

test('simulate: 정기 지출은 목요일(매주)·1일(매월)에 빠지고 kind 는 expense', () => {
  // 2026-10-29 목 시작 → 10/29 목, 11/1 일(1일), 11/5 목
  const cfg = Object.assign(base(), { weekly: 0, monthly: 0, rate: 0, hours: 0, have: 100, goal: 1e9,
    start: D(2026, 10, 29), expWeekly: 5, expMonthly: 2 });
  const sim = M.simulate(cfg, 8);
  assert.deepEqual(sim.daily, [95, 95, 95, 93, 93, 93, 93, 88]);
  assert.equal(sim.pts.filter((p) => p.kind === 'expense').length, 3);
  // skipWeeks 는 지출에 영향 없음 (주보만 건너뜀)
  const cfg2 = Object.assign({}, cfg, { weekly: 20, skipWeeks: { 0: true } });
  assert.equal(M.simulate(cfg2, 1).daily[0], 95);
  assert.equal(M.simulate(Object.assign({}, cfg, { weekly: 20 }), 1).daily[0], 115);
});

test('findGoal: 지출이 수입보다 크면 도달 불가, 작으면 그만큼 늦어짐', () => {
  const cfg = base();
  const d0 = M.findGoal(cfg).days;
  assert.ok(M.findGoal(Object.assign({}, cfg, { expWeekly: 5 })).days > d0);
  assert.deepEqual(M.findGoal(Object.assign({}, cfg, { expWeekly: 1000 })), { days: -1 });
  // 일회성 수입이 있으면 그 전에 도달할 수도 있음
  assert.deepEqual(M.findGoal(Object.assign({}, cfg, { expWeekly: 1000, once: { 0: 100 } })), { days: 1 });
});

test('monthIncome: expense 는 주 4.348배 + 월, total 은 차감한 순수익', () => {
  const inc = M.monthIncome(Object.assign(base(), { expWeekly: 3, expMonthly: 2 }));
  assert.ok(Math.abs(inc.expense - (3 * M.WEEK_PER_MONTH + 2)) < 1e-9);
  assert.ok(Math.abs(inc.total - (inc.weekly + inc.monthly + inc.hunt - inc.expense)) < 1e-9);
  assert.equal(M.monthIncome(base()).expense, 0);
});

test('recurTotals: 주기별 합계, 음수·빈 값은 무시', () => {
  assert.deepEqual(M.recurTotals([
    { label: '재획비', amount: 3, every: 'w' }, { label: '큐브', amount: '2.5', every: 'm' },
    { label: '', amount: -1, every: 'w' }, { label: 'x', amount: '', every: 'm' }, { label: 'y', amount: 1 },
  ]), { weekly: 4, monthly: 2.5 });
  assert.deepEqual(M.recurTotals([]), { weekly: 0, monthly: 0 });
  assert.deepEqual(M.recurTotals(null), { weekly: 0, monthly: 0 });
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
  assert.equal(M.fmtEok(99999.7), '10조', '반올림 올림은 조로 넘김');
  assert.equal(M.fmtEok(19999.6), '2조');
  assert.equal(M.fmtEok(10000), '1조');
  assert.equal(M.fmtEok(-19999.6), '-2조');
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
