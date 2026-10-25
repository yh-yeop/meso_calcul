'use strict';
// store.js(캐릭터 저장소)를 브라우저 전역 몇 개만 흉내 내서 돌린다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'store.js'), 'utf8');

// 매 테스트마다 빈(또는 주어진) localStorage 로 새로 띄움
function boot(storage) {
  const data = Object.assign({}, storage);
  const ctx = {
    MesoCore: require('../core.js'),
    localStorage: {
      getItem: k => (k in data ? data[k] : null),
      setItem: (k, v) => { data[k] = String(v); },
      removeItem: k => { delete data[k]; }
    },
    document: { getElementById: () => null, querySelector: () => null, documentElement: { dataset: {} } },
    getComputedStyle: () => ({ getPropertyValue: () => '' })
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC + '\n;this.Meso = Meso;', ctx);
  return { M: ctx.Meso, data, json: k => JSON.parse(data[k]) };
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

test('parseAmount: 억 · 만 · 조 · 게임 숫자, 이상한 글자는 거절', () => {
  const { M } = boot({});
  assert.equal(M.parseAmount('21.5'), 21.5);
  assert.equal(M.parseAmount('21억 3170만'), 21.317);
  assert.equal(M.parseAmount('1조 2000억'), 12000);
  assert.equal(M.parseAmount('2,131,700,000'), 21.317);
  assert.equal(M.parseAmount('21억 abc'), null);
});
