'use strict';
// home.js(이번 주 보스 체크)를 실제 store · ledger · calc 와 함께 vm 에 올려 돌린다.
// 화면은 가짜 DOM 이라 #h-boss 의 click 리스너를 붙잡아 직접 눌러 보고, innerHTML 로 표시를 확인.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function boot() {
  const data = {};
  const els = {};
  function el() {
    const t = {
      innerHTML: '', textContent: '', hidden: false, value: '', children: [], style: {}, dataset: {}, open: false,
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener(ev, f) { (t.L = t.L || {})[ev] = f; }, removeEventListener() {},
      querySelector: () => el(), querySelectorAll: () => [], closest: () => null,
      appendChild() {}, setAttribute() {}, getAttribute: () => null, close() {}, showModal() {}, focus() {}
    };
    return t;
  }
  const ctx = {
    MesoCore: require('../core.js'),
    localStorage: {
      getItem: k => (k in data ? data[k] : null),
      setItem: (k, v) => { data[k] = String(v); },
      removeItem: k => { delete data[k]; }
    },
    document: {
      getElementById: id => els[id] || (els[id] = el()),
      querySelector: () => el(), querySelectorAll: () => [], documentElement: { dataset: {} },
      addEventListener() {}, body: el(), createElement: () => el()
    },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener() {}, setTimeout: () => 0, clearTimeout() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }), console
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(rd('bosses.js'), ctx);
  vm.runInContext(rd('store.js') + '\n;this.Meso = Meso;', ctx);
  const M = ctx.Meso;
  M.toast = function () {};
  ['api.js', 'ledger.js', 'calc.js', 'home.js'].forEach(f => vm.runInContext(rd(f), ctx));
  return { M, els };
}

const plain = v => JSON.parse(JSON.stringify(v));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + ' != ' + b);

const LUCID = { id: 'lucid', d: 'hard', p: 1 };
const WILL = { id: 'will', d: 'hard', p: 1 };
const JIN = { id: 'jinhilla', d: 'hard', p: 1 };
const SEREN = { id: 'seren', d: 'hard', p: 1 };

// 캐릭터 하나 + 주간 루틴으로 시작. click(보스id) 는 보스 행, click() 은 캐릭터 체크박스
function setup(routine, opts) {
  const { M, els } = boot();
  const o = opts || {};
  const c = M.chars.add({ name: o.name || 'X', weekly: o.weekly });
  if (routine) M.chars.setRoutine(c.id, 'w', routine);
  M.home.render();
  const src = 'chk:w:' + M.toISO(M.weekStart(M.today())) + ':' + c.id;
  const key = 'w:' + c.id;
  const fire = target => els['h-boss'].L.click({ target: { closest: s => target(s) } });
  const api = {
    M, els, c, src,
    click(bid, disabled) {
      fire(s => (s === '[data-exp]' ? null : { disabled: !!disabled, dataset: { kind: 'w', cid: c.id, b: bid } }));
      M.home.render();
    },
    expand() { fire(s => (s === '[data-exp]' ? { dataset: { exp: key } } : null)); },
    html: () => els['h-boss'].innerHTML,
    entry: () => M.ledger.findBySrc(src),
    rows: () => { const e = M.ledger.findBySrc(src); return e && e.x ? plain(e.x.b) : []; },
    share: r => M.round(M.bosses.share('w', r), 6)
  };
  return api;
}

// 보스 행 하나의 HTML 조각 (data-b 기준)
function rowHtml(html, bid) {
  const m = html.match(new RegExp('<button class="boss sm"[^>]*data-b="' + bid + '"[^>]*>[\\s\\S]*?</button>'));
  return m ? m[0] : '';
}

test('(a) 루시드(하드) + 윌 체크 → 장부 금액 = 각 몫의 합, 메모도 행에서 만듦', () => {
  const t = setup([LUCID, WILL, JIN]);
  t.click('lucid'); t.click('will');
  const e = t.entry();
  assert.deepEqual(t.rows(), [['lucid', 'hard', 1, t.share(LUCID)], ['will', 'hard', 1, t.share(WILL)]]);
  near(e.a, t.share(LUCID) + t.share(WILL));
  assert.equal(e.m, '루시드(하) · 윌(하)');
});

test('(b) 루틴 난이도·가격을 바꿔도 체크한 기록은 그대로, 행은 기록된 난이도로 표시', () => {
  const t = setup([LUCID, WILL, JIN]);
  t.click('lucid'); t.click('will');
  const before = plain(t.entry());
  t.M.chars.setRoutine(t.c.id, 'w', [{ id: 'lucid', d: 'easy', p: 1 }, WILL, JIN]);
  t.M.bosses.setPrice('w', 'will', 'hard', 1e9);
  t.M.home.render();
  assert.deepEqual(plain(t.entry()), before, '렌더만으로 기록이 바뀌면 안 됨');
  t.expand();
  const lucid = rowHtml(t.html(), 'lucid');
  assert.match(lucid, /루시드 하드/);
  assert.doesNotMatch(lucid, /이지/);
  assert.match(lucid, /aria-checked="true"/);
  assert.match(lucid, new RegExp(t.M.fmtFine(t.share(LUCID)).replace(/[.+]/g, '\\$&')), '금액도 기록값');
  // 안 잡은 보스는 현재 루틴 값
  assert.match(rowHtml(t.html(), 'jinhilla'), /진 힐라 하드/);
});

test('(b2) 체크 안 한 루틴 보스는 현재 난이도 · 몫으로 표시', () => {
  const t = setup([LUCID, WILL]);
  t.M.chars.setRoutine(t.c.id, 'w', [{ id: 'lucid', d: 'easy', p: 1 }, WILL]);
  t.M.home.render(); t.expand();
  const row = rowHtml(t.html(), 'lucid');
  assert.match(row, /루시드 이지/);
  assert.match(row, /aria-checked="false"/);
  assert.match(row, new RegExp(t.M.fmtFine(t.share({ id: 'lucid', d: 'easy', p: 1 })).replace(/[.+]/g, '\\$&')));
});

test('(c) 파티 인원이 바뀌어도 기록은 그대로, 기록된 파티를 표시', () => {
  const t = setup([LUCID, { id: 'will', d: 'hard', p: 2 }]);
  t.click('lucid'); t.click('will');
  const before = plain(t.entry());
  assert.equal(t.rows()[1][2], 2);
  t.M.chars.setRoutine(t.c.id, 'w', [{ id: 'lucid', d: 'hard', p: 3 }, WILL]);
  t.M.home.render(); t.expand();
  assert.deepEqual(plain(t.entry()), before);
  assert.match(rowHtml(t.html(), 'will'), /2인 파티/);
  assert.doesNotMatch(rowHtml(t.html(), 'lucid'), /인 파티/, '기록은 1인');
  // 다른 보스를 새로 체크해도 기존 행은 건드리지 않음
  t.click('lucid'); t.click('lucid');   // 해제 후 다시 체크 → 새로 체크한 것이라 현재 값(3인)
  assert.equal(t.rows().filter(r => r[0] === 'lucid')[0][2], 3);
  assert.deepEqual(t.rows().filter(r => r[0] === 'will')[0], before.x.b[1]);
});

test('(d) 루틴에서 뺀 보스는 기록값 그대로 extra 로 남고, 해제하면 그 기록값만큼 빠짐', () => {
  const t = setup([LUCID, WILL, JIN]);
  t.click('lucid'); t.click('will');
  const e0 = plain(t.entry()), lucidAmt = t.share(LUCID);
  t.M.chars.setRoutine(t.c.id, 'w', [WILL, JIN]);
  t.M.bosses.setPrice('w', 'lucid', 'hard', 1e9);   // 가격이 바뀐 뒤에도
  t.M.home.render(); t.expand();
  assert.deepEqual(plain(t.entry()), e0);
  const row = rowHtml(t.html(), 'lucid');
  assert.match(row, /루틴에서 뺀 보스 · 이번 기록/);
  assert.match(row, /루시드 하드/);
  assert.match(row, /aria-checked="true"/);
  t.click('lucid');
  assert.deepEqual(t.rows().map(r => r[0]), ['will']);
  near(t.entry().a, e0.a - lucidAmt);
  t.click('lucid');   // 루틴에 없으니 다시 켤 수 없음
  assert.deepEqual(t.rows().map(r => r[0]), ['will']);
});

test('(d2) 루틴에서 뺀 보스가 있는 채 다른 보스를 체크해도 extra 는 유지', () => {
  const t = setup([LUCID, WILL, JIN]);
  t.click('lucid');
  t.M.chars.setRoutine(t.c.id, 'w', [WILL, JIN]);
  t.click('will');
  assert.deepEqual(t.rows().map(r => r[0]).sort(), ['lucid', 'will']);
  near(t.entry().a, t.share(LUCID) + t.share(WILL));
});

test('(e) 루틴을 고친 뒤 새로 체크한 보스는 현재 값, 이미 체크한 행은 기록 그대로', () => {
  const t = setup([LUCID, WILL]);
  t.click('lucid'); t.click('will');
  const lucidRow = t.rows()[0], willRow = t.rows()[1];
  t.M.chars.setRoutine(t.c.id, 'w', [{ id: 'lucid', d: 'easy', p: 1 }, { id: 'will', d: 'hard', p: 3 }, SEREN]);
  t.click('seren');
  const rows = t.rows();
  assert.deepEqual(rows.filter(r => r[0] === 'lucid')[0], lucidRow);
  assert.deepEqual(rows.filter(r => r[0] === 'will')[0], willRow);
  assert.deepEqual(rows.filter(r => r[0] === 'seren')[0], ['seren', 'hard', 1, t.share(SEREN)]);
  near(t.entry().a, lucidRow[3] + willRow[3] + t.share(SEREN));
});

test('(e2) 캐릭터 체크박스(전부 체크)는 새 보스만 현재 값으로 더하고 기존 행·뺀 보스는 기록 그대로', () => {
  const t = setup([LUCID, WILL, JIN]);
  t.click('lucid');
  const lucidRow = t.rows()[0];
  t.M.chars.setRoutine(t.c.id, 'w', [{ id: 'lucid', d: 'easy', p: 1 }, { id: 'will', d: 'hard', p: 2 }, JIN]);
  t.click();   // mixed → 전부 체크
  const rows = t.rows();
  assert.deepEqual(rows.map(r => r[0]).sort(), ['jinhilla', 'lucid', 'will']);
  assert.deepEqual(rows.filter(r => r[0] === 'lucid')[0], lucidRow);
  assert.deepEqual(rows.filter(r => r[0] === 'will')[0], ['will', 'hard', 2, t.share({ id: 'will', d: 'hard', p: 2 })]);
  // 다 체크된 상태에서 다시 누르면 기록째 제거
  t.click();
  assert.equal(t.entry(), null);
});

test('(e3) 전부 체크할 때 루틴에서 뺀 보스는 그대로 남음', () => {
  const t = setup([LUCID, WILL]);
  t.click('lucid');
  t.M.chars.setRoutine(t.c.id, 'w', [WILL]);
  t.click();
  assert.deepEqual(t.rows().map(r => r[0]).sort(), ['lucid', 'will']);
});

test('(f) 통째 기록(30억) 뒤 루틴이 생기면 보스 행은 잠기고 눌러도 30억 그대로, 캐릭터 체크는 제거', () => {
  const t = setup(null, { weekly: 30 });
  t.click();   // 루틴 없음 → 통째 기록
  assert.equal(t.entry().a, 30);
  assert.equal(t.entry().x, undefined);
  t.M.chars.setRoutine(t.c.id, 'w', [LUCID, WILL]);
  t.M.home.render(); t.expand();
  const h = t.html();
  assert.match(h, /캐릭터 체크를 풀면 보스별로 기록 가능/);
  assert.match(rowHtml(h, 'lucid'), /disabled/);
  assert.match(rowHtml(h, 'will'), /disabled/);
  t.click('lucid');          // 비활성이 아닌 척 눌러도
  t.click('will', true);
  assert.equal(t.entry().a, 30);
  assert.equal(t.entry().x, undefined);
  t.click();   // 캐릭터 체크박스 → 해제
  assert.equal(t.entry(), null);
});

test('(g) 지운 캐릭터의 체크 기록과 이름이 같은 새 캐릭터는 직접 기록됨으로 잠김', () => {
  const t = setup([LUCID, WILL]);
  t.click('lucid');
  const a = t.entry().a;
  t.M.chars.remove(t.c.id);
  const c2 = t.M.chars.add({ name: 'X' });
  t.M.chars.setRoutine(c2.id, 'w', [LUCID, WILL]);
  t.M.home.render();
  const h = t.html();
  assert.match(h, /장부에 직접 기록됨/);
  assert.match(h, new RegExp('data-cid="' + c2.id + '"[^>]*disabled'));
  // 눌러도 장부는 그대로
  t.els['h-boss'].L.click({ target: { closest: s => (s === '[data-exp]' ? null : { disabled: false, dataset: { kind: 'w', cid: c2.id } }) } });
  t.els['h-boss'].L.click({ target: { closest: s => (s === '[data-exp]' ? null : { disabled: false, dataset: { kind: 'w', cid: c2.id, b: 'will' } }) } });
  assert.equal(t.M.ledger.count(), 1);
  assert.equal(t.entry().a, a);
});

test('(h) 이후 토글해도 기록 날짜는 처음 체크한 날 그대로', () => {
  const t = setup([LUCID, WILL, JIN]);
  t.click('lucid');
  const e = t.entry(), id = e.id;
  e.d = t.M.toISO(t.M.weekStart(t.M.today()));   // 주 첫날로 돌려 놓고
  const d0 = e.d;
  t.click('will'); t.click('jinhilla'); t.click('lucid');
  assert.equal(t.entry().id, id, '같은 기록을 갱신');
  assert.equal(t.entry().d, d0);
  assert.equal(t.M.ledger.count(), 1);
});

test('마지막 보스를 해제하면 기록 자체가 사라짐', () => {
  const t = setup([LUCID, WILL]);
  t.click('lucid');
  t.click('lucid');
  assert.equal(t.entry(), null);
});

test('home 은 resync 를 내보내지 않음', () => {
  const { M } = boot();
  assert.equal(typeof M.home.render, 'function');
  assert.equal(M.home.resync, undefined);
});
