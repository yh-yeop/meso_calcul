'use strict';
// ledger.js(장부)를 브라우저 전역 몇 개만 흉내 내서 돌린다. 화면은 안 그리고 공개 함수만 검사.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const FILES = ['rules.js', 'bosses.js', 'store.js', 'api.js', 'ledger.js'].map(read);

// ledger.js 는 불러오는 즉시 이벤트를 달고 예산 칸을 만들므로, 뭘 해도 안 터지는 요소 모양을 돌려줌
function stubEl() {
  const el = {
    value: '', textContent: '', innerHTML: '', hidden: false, className: '', title: '', placeholder: '',
    disabled: false, open: false, dataset: {}, style: {}, children: [], clientWidth: 0,
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener() {}, setAttribute() {}, removeAttribute() {}, focus() {}, showModal() {}, close() {},
    closest: () => null,
    querySelector: () => stubEl(),
    querySelectorAll: () => []
  };
  return el;
}

function boot(storage) {
  const data = Object.assign({}, storage);
  const ctx = {
    MesoCore: require('../core.js'),
    localStorage: {
      getItem: k => (k in data ? data[k] : null),
      setItem: (k, v) => { data[k] = String(v); },
      removeItem: k => { delete data[k]; }
    },
    document: {
      getElementById: () => stubEl(), querySelector: () => null, querySelectorAll: () => [],
      documentElement: { dataset: {} }
    },
    getComputedStyle: () => ({ getPropertyValue: () => '' })
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  // store.js 가 만든 Meso 에 calc 를 미리 달아 둬야 하는데, 최상위 var 라 같은 스크립트 안에서 이어 붙임
  vm.runInContext(FILES[0], ctx);
  vm.runInContext(FILES[1], ctx);
  vm.runInContext(FILES[2], ctx);
  vm.runInContext('Meso.calc = { cfg: function(){ return null; } };', ctx);
  vm.runInContext(FILES[3], ctx);
  vm.runInContext(FILES[4] + '\n;this.Meso = Meso;', ctx);
  return { M: ctx.Meso, data, L: ctx.Meso.ledger, json: k => JSON.parse(data[k]) };
}
// vm 컨텍스트에서 만든 객체는 프로토타입이 달라 deepEqual 전에 평범한 값으로
const plain = v => JSON.parse(JSON.stringify(v));
const good = (o) => Object.assign({ id: 1, d: '2026-03-05', t: 'in', a: 10, c: 'hunt' }, o);

/* ---------- sanitize ---------- */

test('모르는 항목 키는 "etc" 로 — 화면에 raw 키가 나가지 않음', () => {
  const { L } = boot({});
  const evil = '<img src=x onerror=alert(1)>';
  const s = L.sanitize({ entries: [good({ c: evil }), good({ id: 2, t: 'out', c: evil })] });
  assert.deepEqual(plain(s.entries.map(e => e.c)), ['etc', 'etc']);
  assert.equal(L.cat('in', evil).k, 'etc');
  assert.equal(L.cat('out', evil).n, '기타');
  assert.ok(!JSON.stringify(L.cat('in', evil)).includes('<img'), 'cat() 이 raw 키를 돌려주면 안 됨');
  // 수입 항목 키를 지출에 써도 안 통함 (weekly 는 out 에 없음)
  assert.equal(L.sanitize({ entries: [good({ t: 'out', c: 'weekly' })] }).entries[0].c, 'etc');
});

test('bal 기록에는 항목(c)이 없음', () => {
  const { L } = boot({});
  const s = L.sanitize({ entries: [good({ t: 'bal', c: 'hunt' })] });
  assert.equal(s.entries.length, 1);
  assert.equal('c' in s.entries[0], false);
});

test('없는 날짜(2026-02-30) · 형식이 다른 날짜는 버림', () => {
  const { L } = boot({});
  const s = L.sanitize({ entries: [good({ d: '2026-02-30' }), good({ id: 2, d: '2026-2-3' }), good({ id: 3, d: 20260305 }), good({ id: 4 })] });
  assert.deepEqual(plain(s.entries.map(e => e.id)), [4]);
});

test('금액 절댓값이 1e7(억) 을 넘으면 버리고, 경계값은 남김', () => {
  const { L } = boot({});
  const s = L.sanitize({ entries: [good({ a: 1e7 + 1 }), good({ id: 2, a: -1e7 - 1 }), good({ id: 3, a: 1e7 }), good({ id: 4, a: -5, t: 'bal' }),
    good({ id: 5, a: 'abc' }), good({ id: 6, a: Infinity })] });
  assert.deepEqual(plain(s.entries.map(e => e.id)), [3, 4]);
});

test('id 가 겹치거나 없으면 새로 매기고 seq 는 그 이상', () => {
  const { L } = boot({});
  const s = L.sanitize({ seq: 2, entries: [good({ id: 5 }), good({ id: 5 }), good({ id: 5 }), { d: '2026-03-05', t: 'in', a: 1 }] });
  const ids = s.entries.map(e => e.id);
  assert.equal(new Set(ids).size, 4, 'id 는 전부 달라야 함');
  assert.ok(ids.every(i => Number.isInteger(i) && i >= 1));
  assert.equal(ids[0], 5, '첫 기록 id 는 유지');
  assert.ok(s.seq >= Math.max.apply(null, ids));
});

test('사냥 시간 h 가 24 를 넘거나 0 이하면 h 만 빠짐 (기록은 남음)', () => {
  const { L } = boot({});
  const s = L.sanitize({ entries: [good({ h: 25 }), good({ id: 2, h: 0 }), good({ id: 3, h: 24 }), good({ id: 4, h: 1.5 })] });
  assert.equal(s.entries.length, 4);
  assert.deepEqual(plain(s.entries.map(e => e.h === undefined ? null : e.h)), [null, null, 24, 1.5]);
});

test('캐릭터 이름(ch)은 40자, 메모(m)는 200자로 자름', () => {
  const { L } = boot({});
  const e = L.sanitize({ entries: [good({ ch: 'c'.repeat(100), m: 'm'.repeat(500) })] }).entries[0];
  assert.equal(e.ch.length, 40);
  assert.equal(e.m.length, 200);
});

test('x.items 가 배열이 아니면 x 가 통째로 사라짐', () => {
  const { L } = boot({});
  const s = L.sanitize({ entries: [good({ x: { items: 'nope' } }), good({ id: 2, x: { items: { a: 1 } } }), good({ id: 3, x: 5 })] });
  assert.equal(s.entries.length, 3);
  s.entries.forEach(e => assert.equal('x' in e, false));
});

test('x.items 는 배열 항목만 남기고, 걸러서 비면 items 도 없음', () => {
  const { L } = boot({});
  const s = L.sanitize({ entries: [
    good({ x: { items: [['a', 1, 2], 'junk', null, ['b', 'x', -1]], n: 3 } }),
    good({ id: 2, x: { items: ['junk', 3], n: 1 } })
  ] });
  assert.deepEqual(plain(s.entries[0].x.items), [['a', 1, 2], ['b', 0, 0]]);
  assert.deepEqual(plain(s.entries[1].x), { n: 1 }, '빈 items 는 안 남김');
});

test('x.b 는 잘못된 행을 걸러내고 숫자는 범위 안으로', () => {
  const { L } = boot({});
  const s = L.sanitize({ entries: [good({ x: { b: [['lucid', 'hard', 9, 5], ['will', 'hard', 0, -1], [3, 'x', 1, 1], 'bad', null] } })] });
  assert.deepEqual(plain(s.entries[0].x.b), [['lucid', 'hard', 6, 5], ['will', 'hard', 1, 0]]);
});

test('x.b 가 걸러져 비면 b:[] 를 남기지 않음 — 다른 값도 없으면 x 도 없음', () => {
  const { L } = boot({});
  const s = L.sanitize({ entries: [
    good({ x: { b: [[1, 1], [2, 2], 'bad'] } }),
    good({ id: 2, x: { b: [], n: 4 } }),
    good({ id: 3, x: { b: 'nope' } })
  ] });
  assert.equal('x' in s.entries[0], false);
  assert.deepEqual(plain(s.entries[1].x), { n: 4 }, 'b 만 빠지고 나머지는 유지');
  assert.equal('x' in s.entries[2], false);
  assert.ok(!JSON.stringify(s).includes('"b":[]'));
});

test('api.skip 은 "api:" 로 시작하는 키만, api.last.pot 은 올바른 날짜만', () => {
  const { L } = boot({});
  const s = L.sanitize({ entries: [], api: {
    skip: { 'api:pot:2026-03-05:A': 1, 'chk:2026-W10:a': 1, '<b>': 1, 'xapi:1': 1 },
    last: { pot: '2026-03-05' }, run: '2026-03-06T00:00:00.000Z' } });
  assert.deepEqual(plain(Object.keys(s.api.skip)), ['api:pot:2026-03-05:A']);
  assert.equal(s.api.last.pot, '2026-03-05');
  assert.equal(L.sanitize({ api: { last: { pot: '2026-02-30' } } }).api.last.pot, undefined);
  assert.equal(L.sanitize({ api: { last: { pot: 'hello' } } }).api.last.pot, undefined);
  assert.equal(L.sanitize({ api: { last: { pot: 20260305 } } }).api.last.pot, undefined);
  assert.equal(L.sanitize({ api: { run: 'not a date' } }).api.run, null);
});

test('sanitize 는 원본을 안 바꾸고, 다시 돌려도 결과가 같음 (멱등)', () => {
  const { L } = boot({});
  const input = {
    v: 7, seq: 3, entries: [
      good({ c: '<script>', h: 99, ch: 'c'.repeat(80), x: { b: [['lucid', 'hard', 9, 5], 'bad'], items: [['a', 1, 2]], n: 2, rules: 'r'.repeat(50) } }),
      good({ id: 1, d: '2026-02-30' }),
      good({ id: 1, t: 'bal', c: 'hunt', a: -3 }),
      { junk: true }, null, 3,
      good({ id: 9, src: 'api:pot:2026-03-05:A', est: 1, lock: 1, t: 'out', c: 'pot', x: { b: [] } })
    ],
    budget: { total: 5, cats: { sf: 3, pot: -1, nope: 9 } },
    api: { skip: { 'api:a': 1, zz: 1 }, last: { pot: '2026-03-05' }, run: null }
  };
  const before = JSON.stringify(input);
  const once = L.sanitize(input);
  assert.equal(JSON.stringify(input), before, '원본은 그대로');
  assert.equal(JSON.stringify(L.sanitize(once)), JSON.stringify(once));
  assert.deepEqual(plain(once.budget), { total: 5, cats: { sf: 3 } });
});

test('이상한 입력(null · 배열 · 문자열)에도 빈 상태를 돌려줌', () => {
  const { L } = boot({});
  [null, undefined, 5, 'x', [], {}, { entries: 'no' }].forEach(v => {
    const s = L.sanitize(v);
    assert.deepEqual(plain(s.entries), []);
    assert.equal(s.seq, 0);
  });
});

/* ---------- inspect ---------- */

test('inspect: 버려진 기록 수를 세고, state 는 sanitize 결과와 같으며 dropped 는 상태에 안 섞임', () => {
  const { L } = boot({});
  const input = { entries: [good(), good({ id: 2, d: '2026-02-30' }), good({ id: 3, a: 1e9 }), null, 'x', good({ id: 4, t: 'bad' }), good({ id: 5 })] };
  const r = L.inspect(input);
  assert.equal(r.dropped, 5);
  assert.equal(JSON.stringify(r.state), JSON.stringify(L.sanitize(input)));
  assert.equal(r.state.entries.length, 2);
  assert.equal('dropped' in r.state, false, '저장될 상태에 dropped 가 들어가면 안 됨');
  assert.equal(L.inspect({ entries: [good()] }).dropped, 0);
  assert.equal(L.inspect(null).dropped, 0);
  assert.equal(L.inspect({ entries: 'no' }).dropped, 0);
});

test('inspect 는 장부 상태를 안 바꿈', () => {
  const { L } = boot({});
  L.addEntry({ t: 'in', c: 'etc', a: 1, d: '2026-03-05' });
  L.inspect({ entries: [good()] });
  assert.equal(L.count(), 1);
});

/* ---------- setCheck · findBySrc ---------- */

const SRC = 'chk:w:2026-03-05:abc';
const snap = L => plain(L.entries());

test('setCheck 새로 만들기: 기록이 생기고 되돌리면 사라짐', () => {
  const { L, json } = boot({});
  const undo = L.setCheck(SRC, { d: '2026-03-05', t: 'in', c: 'weekly', ch: '본캐', a: 12.5, x: { b: [['lucid', 'hard', 1, 5.97]] } });
  const e = plain(L.findBySrc(SRC));
  assert.equal(e.a, 12.5);
  assert.equal(e.d, '2026-03-05');
  assert.equal(e.c, 'weekly');
  assert.equal(L.count(), 1);
  assert.equal(json('meso-ledger-v1').entries.length, 1, '저장도 됨');
  undo();
  assert.equal(L.findBySrc(SRC), null);
  assert.equal(L.count(), 0);
  assert.equal(json('meso-ledger-v1').entries.length, 0);
});

test('setCheck 갱신: 날짜(d)는 처음 체크한 날 그대로, a · m · x 만 바뀜', () => {
  const { L } = boot({});
  L.setCheck(SRC, { d: '2026-03-05', t: 'in', c: 'weekly', ch: '본캐', a: 10, m: '처음', x: { b: [['lucid', 'hard', 1, 10]] } });
  const id = L.findBySrc(SRC).id;
  L.setCheck(SRC, { d: '2026-03-09', t: 'in', c: 'weekly', ch: '본캐', a: 22.5, m: '둘', x: { b: [['lucid', 'hard', 1, 10], ['will', 'hard', 1, 12.5]] } });
  const e = plain(L.findBySrc(SRC));
  assert.equal(L.count(), 1, '같은 src 는 한 건');
  assert.equal(e.id, id);
  assert.equal(e.d, '2026-03-05', '날짜는 안 바뀜');
  assert.equal(e.a, 22.5);
  assert.equal(e.m, '둘');
  assert.equal(e.x.b.length, 2);
});

test('setCheck 갱신 뒤 되돌리면 이전 기록 그대로 복원', () => {
  const { L } = boot({});
  L.setCheck(SRC, { d: '2026-03-05', t: 'in', c: 'weekly', ch: '본캐', a: 10, m: '처음', x: { b: [['lucid', 'hard', 1, 10]] } });
  const before = snap(L);
  const undo = L.setCheck(SRC, { d: '2026-03-09', t: 'in', c: 'weekly', ch: '본캐', a: 22.5, m: '둘', x: { b: [['will', 'hard', 1, 12.5]] } });
  assert.notDeepEqual(snap(L), before);
  undo();
  assert.deepEqual(snap(L), before);
  assert.equal(L.count(), 1);
});

test('setCheck(src, null): 지우고, 되돌리면 복원. 없는 src 는 아무 일 없음', () => {
  const { L } = boot({});
  L.setCheck(SRC, { d: '2026-03-05', t: 'in', c: 'weekly', ch: '본캐', a: 10 });
  const before = snap(L);
  const undo = L.setCheck(SRC, null);
  assert.equal(L.findBySrc(SRC), null);
  assert.equal(L.count(), 0);
  undo();
  assert.deepEqual(snap(L), before);
  const noop = L.setCheck('chk:none', null);
  assert.equal(typeof noop, 'function');
  noop();
  assert.equal(L.count(), 1, '없는 src 지우기의 되돌리기는 다른 기록을 안 건드림');
});

test('addEntry 되돌리기는 그 기록만 지움', () => {
  const { L } = boot({});
  L.addEntry({ t: 'in', c: 'etc', a: 1, d: '2026-03-05' });
  const undo = L.addEntry({ t: 'out', c: 'buy', a: 2, d: '2026-03-06' });
  assert.equal(L.count(), 2);
  undo();
  assert.deepEqual(plain(L.entries()).map(e => e.t), ['in']);
});

test('저장된 장부를 불러올 때도 같은 검사를 거침 (깨진 기록은 걸러짐)', () => {
  const saved = { v: 1, seq: 2, entries: [good({ c: '<img>' }), good({ id: 2, d: '2026-02-30' })] };
  const { L } = boot({ 'meso-ledger-v1': JSON.stringify(saved) });
  assert.equal(L.count(), 1);
  assert.equal(L.entries()[0].c, 'etc');
});
