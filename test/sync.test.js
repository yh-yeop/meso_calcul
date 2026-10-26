const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../core.js");
const S = C.sync;

const E = (id, a, extra) => Object.assign({id, d:"2026-10-20", t:"in", c:"hunt", a}, extra || {});
const L = (entries, more) => Object.assign({v:1, seq:Math.max(0, ...entries.map(e => e.id)), entries, budget:{total:0, cats:{}}, api:{last:{}, skip:{}, run:null}}, more || {});
const st = (ledger, chars, calc, prices) => ({ledger, chars: chars || null, calc: calc || null, prices: prices || null});
const ids = s => s.ledger.entries.map(e => e.id);
const amts = s => s.ledger.entries.map(e => e.a).sort((a, b) => a - b);

// base 를 만든 뒤 양쪽이 각자 고친 상황
function fork(start){ return {base: S.baseOf(start), local: structuredClone(start), remote: structuredClone(start)}; }

test("해시는 키 순서와 상관없음", () => {
  assert.equal(S.hash({a:1, b:[1, {c:2, d:3}]}), S.hash({b:[1, {d:3, c:2}], a:1}));
  assert.notEqual(S.hash({a:1}), S.hash({a:2}));
});

test("한쪽에서만 추가 · 수정 · 삭제하면 그대로 반영", () => {
  const f = fork(st(L([E(1, 10), E(2, 20), E(3, 30)])));
  f.local.ledger.entries.push(E(4, 40));                     // 로컬 추가
  f.remote.ledger.entries[0].a = 11;                          // 클라우드에서 1번 수정
  f.remote.ledger.entries = f.remote.ledger.entries.filter(e => e.id !== 3);  // 클라우드에서 3번 삭제
  const m = S.merge(f.local, f.remote, f.base);
  assert.deepEqual(ids(m.state), [1, 2, 4]);
  assert.equal(m.state.ledger.entries[0].a, 11);
  assert.equal(m.toLocal, true);
  assert.equal(m.toRemote, true);
});

test("양쪽에서 같은 id 로 새 기록 → 둘 다 살아남고 로컬 것이 새 id", () => {
  const f = fork(st(L([E(1, 10)])));
  f.local.ledger.entries.push(E(2, 5)); f.local.ledger.seq = 2;
  f.remote.ledger.entries.push(E(2, 7)); f.remote.ledger.seq = 2;
  const m = S.merge(f.local, f.remote, f.base);
  assert.deepEqual(ids(m.state), [1, 2, 3]);
  assert.deepEqual(amts(m.state), [5, 7, 10]);
  assert.equal(m.state.ledger.entries.find(e => e.id === 2).a, 7);  // 클라우드 것이 원래 id
  assert.equal(m.state.ledger.seq, 3);
});

test("지웠는데 다른 쪽에서 고쳤으면 고친 것을 살림", () => {
  const f = fork(st(L([E(1, 10), E(2, 20)])));
  f.local.ledger.entries = f.local.ledger.entries.filter(e => e.id !== 2);
  f.remote.ledger.entries[1].a = 25;
  const m = S.merge(f.local, f.remote, f.base);
  assert.deepEqual(ids(m.state), [1, 2]);
  assert.equal(m.state.ledger.entries[1].a, 25);
});

test("둘 다 같은 기록을 다르게 고치면 이 기기 쪽", () => {
  const f = fork(st(L([E(1, 10)])));
  f.local.ledger.entries[0].a = 12;
  f.remote.ledger.entries[0].a = 13;
  assert.equal(S.merge(f.local, f.remote, f.base).state.ledger.entries[0].a, 12);
});

test("같은 보스 체크(src)가 양쪽에서 따로 생기면 로컬 것 하나만", () => {
  const f = fork(st(L([E(1, 10)])));
  const src = "chk:w:2026-10-22:a1";
  f.local.ledger.entries.push(E(2, 1.4, {c:"weekly", src}));
  f.remote.ledger.entries.push(E(5, 0.6, {c:"weekly", src})); f.remote.ledger.seq = 5;
  const m = S.merge(f.local, f.remote, f.base);
  const chk = m.state.ledger.entries.filter(e => e.src === src);
  assert.equal(chk.length, 1);
  assert.equal(chk[0].a, 1.4);
});

test("예산 · 계산기 · 가격은 바뀐 쪽, 둘 다면 로컬", () => {
  const start = st(L([]), null, {goal:3000}, {"lucid:hard":59700000});
  const f = fork(start);
  f.remote.ledger.budget = {total:300, cats:{}};
  f.remote.calc = {goal:5000};
  f.local.prices = {"lucid:hard":60000000};
  f.remote.prices = {"lucid:hard":61000000};
  const m = S.merge(f.local, f.remote, f.base).state;
  assert.equal(m.ledger.budget.total, 300);
  assert.equal(m.calc.goal, 5000);
  assert.equal(m.prices["lucid:hard"], 60000000);
});

test("캐릭터: 클라우드에서 순서 바꾸고 로컬에서 추가 → 클라우드 순서 + 새 캐릭터 뒤", () => {
  const ch = list => ({v:1, list});
  const c = (id, name) => ({id, name, weekly:0, monthly:0, main:id === "a"});
  const f = fork(st(L([]), ch([c("a", "본캐"), c("b", "부캐"), c("c", "삼캐")])));
  f.remote.chars.list = [f.remote.chars.list[2], f.remote.chars.list[0], f.remote.chars.list[1]];
  f.local.chars.list.push(c("d", "사캐"));
  f.local.chars.list[1].weekly = 3;
  const m = S.merge(f.local, f.remote, f.base).state;
  assert.deepEqual(m.chars.list.map(x => x.id), ["c", "a", "b", "d"]);
  assert.equal(m.chars.list.find(x => x.id === "b").weekly, 3);
});

test("처음 연결해서 합치기 — id 만 다르고 내용이 같은 기록은 하나로, 다른 건 다 살림", () => {
  const local = st(L([E(1, 10, {m:"같은 기록"}), E(2, 20)]));
  const remote = st(L([E(7, 10, {m:"같은 기록"}), E(1, 99)]));
  const m = S.merge(local, remote, null).state;
  assert.deepEqual(amts(m), [10, 20, 99]);
  assert.equal(new Set(ids(m)).size, 3);
});

test("한쪽이 비어 있으면 다른 쪽 그대로", () => {
  const remote = st(L([E(1, 10)]), {v:1, list:[{id:"a", name:"본캐"}]});
  const m = S.merge(st(null), remote, null);
  assert.deepEqual(m.state.ledger, remote.ledger);
  assert.equal(m.toRemote, false);
  assert.equal(m.toLocal, true);
});

test("멱등 — 합친 결과를 다시 합쳐도 같고 더 쓸 게 없음", () => {
  const f = fork(st(L([E(1, 10), E(2, 20)])));
  f.local.ledger.entries.push(E(3, 30)); f.local.ledger.seq = 3;
  f.remote.ledger.entries.push(E(3, 31)); f.remote.ledger.seq = 3;
  const once = S.merge(f.local, f.remote, f.base).state;
  const twice = S.merge(once, once, S.baseOf(once));
  assert.equal(S.hash(twice.state), S.hash(once));
  assert.equal(twice.toLocal, false);
  assert.equal(twice.toRemote, false);
});

test("장부 해마다 나누기 · 합치기 왕복", () => {
  const l = L([E(3, 1, {d:"2027-01-02"}), E(1, 2, {d:"2025-12-31"}), E(2, 3)]);
  const p = S.splitLedger(l);
  assert.deepEqual(Object.keys(p.years).sort(), ["2025", "2026", "2027"]);
  assert.equal(p.meta.entries, undefined);
  const back = S.joinLedger(JSON.parse(JSON.stringify(p.meta)), JSON.parse(JSON.stringify(p.years)));
  assert.deepEqual(back.entries.map(e => e.id), [1, 2, 3]);
  assert.equal(back.seq, l.seq);
});

test("두 기기가 번갈아 오프라인 편집해도 결국 같아짐", () => {
  // 가짜 클라우드 하나, 기기 둘 — 각 기기는 자기 base 를 들고 있음
  let cloud = st(L([E(1, 10)]));
  const dev = () => ({data: structuredClone(cloud), base: S.baseOf(cloud)});
  const A = dev(), B = dev();
  function sync(d){
    const m = S.merge(d.data, cloud, d.base);
    d.data = structuredClone(m.state);
    if (m.toRemote) cloud = structuredClone(m.state);
    d.base = S.baseOf(m.state);
  }
  A.data.ledger.entries.push(E(2, 20)); A.data.ledger.seq = 2;
  B.data.ledger.entries.push(E(2, 21)); B.data.ledger.seq = 2;
  B.data.ledger.entries[0].a = 15;
  sync(A); sync(B); sync(A);
  assert.deepEqual(amts(A.data), [15, 20, 21]);                          // 충돌한 두 기록 다 받음
  A.data.ledger.entries = A.data.ledger.entries.filter(e => e.a !== 21);   // A 가 B 의 기록을 지움
  sync(A); sync(B);
  assert.equal(S.hash(A.data), S.hash(B.data));
  assert.equal(S.hash(A.data), S.hash(cloud));
  assert.deepEqual(amts(cloud), [15, 20]);
});
