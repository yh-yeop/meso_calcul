'use strict';
// store.js(캐릭터 저장소)를 브라우저 전역 몇 개만 흉내 내서 돌린다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'store.js'), 'utf8');
const BOSSES = fs.readFileSync(path.join(__dirname, '..', 'bosses.js'), 'utf8');

// 매 테스트마다 빈(또는 주어진) localStorage 로 새로 띄움
function boot(storage) {
  const data = Object.assign({}, storage);
  const failing = { on: false };
  const ctx = {
    MesoCore: require('../core.js'),
    localStorage: {
      getItem: k => (k in data ? data[k] : null),
      setItem: (k, v) => { if (failing.on) throw new Error('QuotaExceededError'); data[k] = String(v); },
      removeItem: k => { delete data[k]; }
    },
    document: { getElementById: () => null, querySelector: () => null, documentElement: { dataset: {} } },
    getComputedStyle: () => ({ getPropertyValue: () => '' })
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(BOSSES, ctx);
  vm.runInContext(SRC + '\n;this.Meso = Meso;', ctx);
  return { M: ctx.Meso, data, failing, json: k => JSON.parse(data[k]) };
}
// vm 컨텍스트에서 만든 객체는 프로토타입이 달라 deepEqual 전에 평범한 값으로
const plain = v => JSON.parse(JSON.stringify(v));

test('처음 열면 예전 계산기 로스터(r)에서 캐릭터를 옮겨 오고 첫 캐릭터가 본캐', () => {
  const calc = { v: 1, r: [['호야시치', 34.8012, 13.3], ['부캐', 14.258, 6.65]], rate: '3' };
  const { M, json } = boot({ 'meso-calc-v1': JSON.stringify(calc) });
  const list = plain(M.chars.all()).map(c => [c.name, c.weekly, c.monthly, c.main]);
  assert.deepEqual(list, [['호야시치', 34.8012, 13.3, true], ['부캐', 14.258, 6.65, false]]);
  assert.equal(json('meso-chars-v1').list.length, 2, '옮긴 결과를 바로 저장');
  assert.deepEqual(plain(M.chars.totals()), { weekly: 34.8012 + 14.258, monthly: 13.3 + 6.65 });
});

test('캐릭터 저장소가 이미 있으면 계산기 로스터를 다시 안 읽음', () => {
  const chars = { v: 1, list: [{ id: 'a', name: '본캐', weekly: 10, monthly: 0, main: true }] };
  const calc = { r: [['딴캐', 99, 99]] };
  const { M } = boot({ 'meso-chars-v1': JSON.stringify(chars), 'meso-calc-v1': JSON.stringify(calc) });
  assert.deepEqual(plain(M.chars.all()).map(c => c.name), ['본캐']);
});

test('정산표 붙여넣기는 이름이 같으면 수익만 갱신, 없으면 추가 (메타는 유지)', () => {
  const chars = { v: 1, list: [{ id: 'a', name: '호야시치', weekly: 1, monthly: 1, main: true, world: '베라', level: 289 }] };
  const { M } = boot({ 'meso-chars-v1': JSON.stringify(chars) });
  const r = M.chars.mergeIncome([{ name: '호야시치', weekly: 21.317, monthly: 6.65 }, { name: '새캐', weekly: 5, monthly: 0 }]);
  assert.deepEqual(plain(r), { added: 1, updated: 1 });
  const ho = M.chars.byName('호야시치');
  assert.equal(ho.weekly, 21.317);
  assert.equal(ho.world, '베라', '붙여넣기가 월드 · 레벨을 지우면 안 됨');
  assert.equal(ho.level, 289);
  assert.equal(M.chars.all().length, 2);
});

test('Open API 목록은 이름이 같으면 정보만, 없으면 수익 0으로 추가', () => {
  const chars = { v: 1, list: [{ id: 'a', name: '호야시치', weekly: 34.8, monthly: 13.3, main: true }] };
  const { M } = boot({ 'meso-chars-v1': JSON.stringify(chars) });
  M.chars.mergeApi([
    { ocid: 'o1', character_name: '호야시치', world_name: '베라', character_class: '소울마스터', character_level: 289 },
    { ocid: 'o2', character_name: '부캐', world_name: '베라', character_class: '비숍', character_level: 260 }
  ]);
  const ho = M.chars.byName('호야시치'), bu = M.chars.byName('부캐');
  assert.equal(ho.weekly, 34.8, '기존 수익 유지');
  assert.equal(ho.ocid, 'o1');
  assert.equal(ho.cls, '소울마스터');
  assert.equal(bu.weekly, 0);
  assert.equal(bu.level, 260);
});

test('이름을 바꾸면 char-rename 알림 (장부가 이걸 받아 기록의 캐릭터 이름을 바꿈)', () => {
  const chars = { v: 1, list: [{ id: 'a', name: '옛이름', weekly: 1, monthly: 0, main: true }] };
  const { M } = boot({ 'meso-chars-v1': JSON.stringify(chars) });
  const got = [];
  M.on('char-rename', r => got.push(plain(r)));
  M.chars.update('a', { weekly: 2 });
  M.chars.update('a', { name: '새이름' });
  assert.deepEqual(got, [{ from: '옛이름', to: '새이름' }], '이름이 안 바뀐 수정은 알림 없음');
});

test('본캐는 하나만 — 다른 캐릭터를 본캐로 지정하면 기존 본캐가 풀림', () => {
  const chars = { v: 1, list: [{ id: 'a', name: 'A', main: true }, { id: 'b', name: 'B' }] };
  const { M } = boot({ 'meso-chars-v1': JSON.stringify(chars) });
  M.chars.update('b', { main: true });
  assert.deepEqual(plain(M.chars.all()).map(c => c.main), [false, true]);
  M.chars.remove('b');
  assert.equal(M.chars.all()[0].main, true, '본캐를 지우면 맨 앞이 본캐');
});

test('공유 링크 로스터는 캐릭터를 링크 것으로 바꾸고, toRoster 로 다시 링크에 실림', () => {
  const { M } = boot({});
  assert.equal(M.chars.replaceFromRoster([['A', 10, 2], ['B', 5, 0]]), true);
  assert.deepEqual(plain(M.chars.toRoster()), [['A', 10, 2], ['B', 5, 0]]);
  assert.equal(M.chars.replaceFromRoster([]), false, '빈 로스터는 무시');
});

test('공유 링크 수락: 이름이 같은 캐릭터는 id · 루틴 · 본캐 · 메타를 유지하고 수익만 링크 값, 없는 캐릭터는 버림', () => {
  const chars = { v: 1, list: [
    { id: 'a', name: 'A', weekly: 1, monthly: 1, main: false },
    { id: 'b', name: 'B', weekly: 1, monthly: 0, main: true, world: '베라', cls: '비숍', level: 260, ocid: 'ob',
      bosses: [{ id: 'lucid', d: 'hard', p: 1 }], mbosses: [{ id: 'blackmage', d: 'hard', p: 1 }] },
    { id: 'c', name: 'C', weekly: 3, monthly: 0 }
  ] };
  const { M } = boot({ 'meso-chars-v1': JSON.stringify(chars) });
  assert.equal(M.chars.replaceFromRoster([['A', 7, 2], [' B ', 9, 4], ['새캐', 5, 0]]), true);
  const list = plain(M.chars.all());
  assert.deepEqual(list.map(c => c.name), ['A', 'B', '새캐'], 'C 는 링크에 없어서 버려짐');
  assert.equal(list[0].id, 'a');
  assert.equal(list[1].id, 'b');
  assert.notEqual(list[2].id, 'c');
  assert.deepEqual(list.map(c => c.main), [false, true, false], '본캐 B 유지, 하나만');
  assert.deepEqual([list[1].world, list[1].cls, list[1].level, list[1].ocid], ['베라', '비숍', 260, 'ob']);
  assert.deepEqual(list[1].bosses, [{ id: 'lucid', d: 'hard', p: 1 }]);
  assert.deepEqual(list[1].mbosses, [{ id: 'blackmage', d: 'hard', p: 1 }]);
  assert.deepEqual([list[0].weekly, list[0].monthly], [7, 2], '수익은 링크 값');
  assert.deepEqual([list[1].weekly, list[1].monthly], [9, 4]);
});

test('공유 링크에 같은 이름이 하나도 없으면 첫 캐릭터가 본캐', () => {
  const { M } = boot({ 'meso-chars-v1': JSON.stringify({ v: 1, list: [{ id: 'a', name: 'A', main: true }] }) });
  M.chars.replaceFromRoster([['X', 1, 0], ['Y', 2, 0]]);
  assert.deepEqual(plain(M.chars.all()).map(c => [c.name, c.main]), [['X', true], ['Y', false]]);
});

test('저장 실패: write 가 false 를 돌려주고 storage-error 알림, saveChars 도 결과를 전달', () => {
  const { M, data, failing } = boot({});
  const got = [];
  M.on('storage-error', k => got.push(k));
  assert.equal(M.write('k1', { a: 1 }), true);
  assert.deepEqual(got, [], '성공하면 알림 없음');
  failing.on = true;
  assert.equal(M.write('k2', 1), false);
  assert.deepEqual(got, ['k2']);
  assert.equal('k2' in data, false);
  M.chars.add({ name: '새캐' });   // saveChars 가 실패해도 throw 하지 않음
  assert.deepEqual(got, ['k2', 'meso-chars-v1']);
  assert.equal(M.chars.all().length, 1, '메모리에는 반영');
});

test('Open API ocid 가 같으면 게임에서 이름을 바꿔도 같은 캐릭터 — 이름을 갱신하고 char-rename 한 번', () => {
  const chars = { v: 1, list: [{ id: 'a', name: '옛이름', weekly: 5, main: true, ocid: 'o1', bosses: [{ id: 'lucid', d: 'hard', p: 1 }] },
                               { id: 'b', name: '남의이름', ocid: 'o2' }] };
  const { M } = boot({ 'meso-chars-v1': JSON.stringify(chars) });
  const got = [];
  M.on('char-rename', r => got.push(plain(r)));
  const r = M.chars.mergeApi([{ ocid: 'o1', character_name: '새이름', world_name: '베라', character_level: 270 }]);
  assert.deepEqual(plain(r), { added: 0, updated: 1 });
  assert.equal(M.chars.all().length, 2, '중복 캐릭터가 생기지 않음');
  const c = M.chars.get('a');
  assert.equal(c.name, '새이름');
  assert.equal(c.level, 270);
  assert.equal(c.bosses.length, 1, '루틴 유지');
  assert.deepEqual(got, [{ from: '옛이름', to: '새이름' }]);
  // 새 이름을 다른 캐릭터가 이미 쓰면 옛 이름 유지 (정보만 갱신)
  M.chars.mergeApi([{ ocid: 'o1', character_name: '남의이름', world_name: '스카니아' }]);
  assert.equal(M.chars.get('a').name, '새이름');
  assert.equal(M.chars.get('a').world, '스카니아');
  assert.equal(got.length, 1);
});

test('parseAmount: 억 · 만 · 조 · 게임 숫자, 이상한 글자는 거절', () => {
  const { M } = boot({});
  assert.equal(M.parseAmount('21.5'), 21.5);
  assert.equal(M.parseAmount('21억 3170만'), 21.317);
  assert.equal(M.parseAmount('1조 2000억'), 12000);
  assert.equal(M.parseAmount('2,131,700,000'), 21.317);
  assert.equal(M.parseAmount('21억 abc'), null);
});

/* ---------- 보스 루틴 ---------- */

test('보스 루틴 합계 = Σ floor(가격 ÷ 인원) / 1억, 루틴이 직접 입력값보다 우선', () => {
  const chars = { v: 1, list: [{ id: 'a', name: '본캐', weekly: 99, monthly: 99, main: true,
    bosses: [{ id: 'lucid', d: 'hard', p: 1 }, { id: 'will', d: 'hard', p: 3 }],
    mbosses: [{ id: 'blackmage', d: 'hard', p: 6 }] }] };
  const { M } = boot({ 'meso-chars-v1': JSON.stringify(chars) });
  const c = M.chars.get('a');
  const will3 = Math.floor(73200000 / 3);          // 24,400,000
  assert.equal(M.chars.weekly(c), (59700000 + will3) / 1e8);
  assert.equal(M.chars.monthly(c), Math.floor(465000000 / 6) / 1e8, '6인 검마는 버림');
  assert.deepEqual(plain(M.chars.totals()), { weekly: (59700000 + will3) / 1e8, monthly: Math.floor(465000000 / 6) / 1e8 });
});

test('루틴이 없으면 예전처럼 직접 넣은 주보 · 월보 (기존 캐릭터 데이터 그대로)', () => {
  const chars = { v: 1, list: [{ id: 'a', name: '부캐', weekly: 14.258, monthly: 6.65 }] };
  const { M } = boot({ 'meso-chars-v1': JSON.stringify(chars) });
  const c = M.chars.get('a');
  assert.equal(M.chars.weekly(c), 14.258);
  assert.equal(M.chars.monthly(c), 6.65);
  assert.equal(c.bosses, undefined);
});

test('루틴 정리: 없는 보스 · 없는 난이도 버림, 보스당 난이도 하나, 인원 1~6, 진행 순서로 정렬', () => {
  const { M } = boot({});
  const c = M.chars.add({ name: 'X' });
  M.chars.setRoutine(c.id, 'w', [
    { id: 'will', d: 'hard', p: 9 }, { id: 'lucid', d: 'hard', p: 0 }, { id: 'lucid', d: 'easy', p: 1 },
    { id: 'nope', d: 'hard', p: 1 }, { id: 'zakum', d: 'hard', p: 1 }
  ]);
  assert.deepEqual(plain(M.chars.get(c.id).bosses), [{ id: 'lucid', d: 'hard', p: 1 }, { id: 'will', d: 'hard', p: 6 }]);
  M.chars.setRoutine(c.id, 'w', []);
  assert.equal(M.chars.get(c.id).bosses, undefined, '빈 루틴이면 필드를 지워 직접 입력값으로 돌아감');
});

test('결정석 가격 덮어쓰기가 합계에 바로 반영되고, 기본값과 같으면 해제', () => {
  const chars = { v: 1, list: [{ id: 'a', name: 'A', bosses: [{ id: 'lucid', d: 'hard', p: 1 }] }] };
  const { M, data } = boot({ 'meso-chars-v1': JSON.stringify(chars) });
  M.bosses.setPrice('w', 'lucid', 'hard', 60000000);
  assert.equal(M.chars.weekly(M.chars.get('a')), 0.6);
  assert.equal(JSON.parse(data['meso-boss-prices'])['lucid:hard'], 60000000);
  M.bosses.setPrice('w', 'lucid', 'hard', 59700000);
  assert.deepEqual(plain(M.bosses.overrides()), {});
  assert.equal(M.chars.weekly(M.chars.get('a')), 0.597);
});

test('루틴 복사와 월드별 결정석 수', () => {
  const chars = { v: 1, list: [
    { id: 'a', name: 'A', world: '베라', bosses: [{ id: 'lucid', d: 'hard', p: 1 }, { id: 'will', d: 'hard', p: 1 }] },
    { id: 'b', name: 'B', world: '베라' }, { id: 'c', name: 'C', world: '스카니아', bosses: [{ id: 'seren', d: 'hard', p: 1 }] }
  ] };
  const { M } = boot({ 'meso-chars-v1': JSON.stringify(chars) });
  M.chars.copyRoutine('a', 'b');
  assert.deepEqual(plain(M.chars.get('b').bosses), plain(M.chars.get('a').bosses));
  assert.deepEqual(plain(M.chars.worldCounts()), { '베라': 4, '스카니아': 1 });
});

/* ---------- 입력 방어 · 중복 · 되돌리기 ---------- */

test('지운 본캐를 되돌리면 그대로 본캐 (맨 앞 캐릭터에게 본캐를 뺏기지 않음)', () => {
  const chars = { v: 1, list: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', main: true }, { id: 'c', name: 'C' }] };
  const { M } = boot({ 'meso-chars-v1': JSON.stringify(chars) });
  const r = M.chars.remove('b');
  assert.equal(M.chars.get('a').main, true, '지우면 맨 앞이 임시 본캐');
  M.chars.restore(r.c, r.i);
  assert.deepEqual(plain(M.chars.all()).map(c => [c.id, c.main]), [['a', false], ['b', true], ['c', false]]);
});

test('예전 계산기 로스터에 같은 이름이 있으면 "이름", "이름 (2)"로 구분', () => {
  const calc = { r: [['이름', 1, 0], ['이름', 2, 0], ['이름', 3, 0]] };
  const { M } = boot({ 'meso-calc-v1': JSON.stringify(calc) });
  assert.deepEqual(plain(M.chars.all()).map(c => c.name), ['이름', '이름 (2)', '이름 (3)']);
  const c = M.chars.add({ name: '이름' });
  assert.equal(c.name, '이름 (4)', '추가할 때도 겹치지 않음');
});

test('Open API 이름 끝 공백은 무시하고 기존 캐릭터를 갱신, 빈 이름은 건너뜀', () => {
  const chars = { v: 1, list: [{ id: 'a', name: '호야시치', weekly: 5, main: true }] };
  const { M } = boot({ 'meso-chars-v1': JSON.stringify(chars) });
  const r = M.chars.mergeApi([{ ocid: 'o1', character_name: '호야시치 ', world_name: '베라' }, { ocid: 'o2', character_name: '  ' }]);
  assert.deepEqual(plain(r), { added: 0, updated: 1 });
  assert.equal(M.chars.all().length, 1);
  assert.equal(M.chars.get('a').world, '베라');
  assert.equal(M.chars.byName(' 호야시치 ').id, 'a', 'byName 도 앞뒤 공백 무시');
});

test('루틴 복사: 원본에 월간 루틴이 없으면 대상의 월간 루틴은 그대로', () => {
  const chars = { v: 1, list: [
    { id: 'a', name: 'A', bosses: [{ id: 'lucid', d: 'hard', p: 1 }] },
    { id: 'b', name: 'B', bosses: [{ id: 'will', d: 'hard', p: 1 }], mbosses: [{ id: 'blackmage', d: 'hard', p: 1 }] }
  ] };
  const { M } = boot({ 'meso-chars-v1': JSON.stringify(chars) });
  M.chars.copyRoutine('a', 'b');
  assert.deepEqual(plain(M.chars.get('b').bosses), [{ id: 'lucid', d: 'hard', p: 1 }]);
  assert.deepEqual(plain(M.chars.get('b').mbosses), [{ id: 'blackmage', d: 'hard', p: 1 }]);
});

test('"constructor" 같은 상속 키는 난이도로 인정 안 함 — 루틴 · 가격 모두 합계가 유한', () => {
  const chars = { v: 1, list: [{ id: 'a', name: 'A', bosses: [{ id: 'lucid', d: 'constructor', p: 1 }, { id: 'will', d: '__proto__', p: 1 }] }] };
  const prices = { 'lucid:constructor': 5, 'lucid:__proto__': 5, 'lucid:hard': 60000000, 'nope:hard': 1, 'will:hard': -3, 'zakum:hard': 1e13 };
  const { M } = boot({ 'meso-chars-v1': JSON.stringify(chars), 'meso-boss-prices': JSON.stringify(prices) });
  assert.equal(M.chars.get('a').bosses, undefined);
  assert.equal(M.bosses.price('w', 'lucid', 'constructor'), 0);
  assert.equal(M.bosses.defaultPrice('w', 'lucid', 'constructor'), 0);
  assert.deepEqual(plain(M.bosses.overrides()), { 'lucid:hard': 60000000 }, '이상한 덮어쓰기는 불러올 때 걸러짐');
  M.bosses.setPrice('w', 'lucid', 'constructor', 100);
  assert.deepEqual(plain(M.bosses.overrides()), { 'lucid:hard': 60000000 }, '없는 난이도 setPrice 는 무시');
  M.bosses.setOverrides({ 'lucid:easy': 1234.6, 'x:y': 5 });
  assert.deepEqual(plain(M.bosses.overrides()), { 'lucid:easy': 1235 });
  assert.ok(Number.isFinite(M.chars.totals().weekly));
});

test('캐릭터 id 에 HTML 이 섞여 있으면 새 id 로 바꾸고, 이름 · 수치도 정리', () => {
  const { M } = boot({});
  M.chars.setAll([{ id: '"><img src=x onerror=alert(1)>', name: ' ' + 'x'.repeat(60), weekly: 1e9, monthly: -5, level: 999, world: 'w'.repeat(50), ocid: 'o'.repeat(100) }]);
  const c = M.chars.all()[0];
  assert.match(c.id, /^[A-Za-z0-9_-]{1,40}$/);
  assert.equal(c.name.length, 40);
  assert.equal(c.weekly, 0);
  assert.equal(c.monthly, 0);
  assert.equal(c.level, undefined);
  assert.equal(c.world.length, 30);
  assert.equal(c.ocid.length, 80);
});

test('setAll 은 객체가 아닌 항목을 건너뜀 (백업 복원 중 throw 금지)', () => {
  const { M } = boot({});
  M.chars.setAll([null, { name: 'A' }, 'x', 3]);
  assert.deepEqual(plain(M.chars.all()).map(c => c.name), ['A']);
});

test('fmtEok: 반올림으로 1조가 넘어가면 조 단위로 올림', () => {
  const { M } = boot({});
  assert.equal(M.fmtEok(99999.7), '10조');
  assert.equal(M.fmtEok(19999.6), '2조');
  assert.equal(M.fmtEok(12345), '1조 2,345억');
});
