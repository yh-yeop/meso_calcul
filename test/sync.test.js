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

/* ---------- 회차 3 (Z1~Z5 · Z41 · Z10 재시도) ---------- */
const amtIds = s => s.ledger.entries.map(e => e.a + "#" + e.id).join(",");
const CH = (id, name, main) => ({id, name, weekly:0, monthly:0, main:!!main});
const chars = list => ({v:1, list});

test("첫 연결: 로컬이 비어 있으면 예산 · 계산기 · 가격까지 클라우드 그대로, 클라우드엔 쓸 것 없음", () => {
  const remote = st(L([E(7, 99)], {budget:{total:300, cats:{hunt:100}}}), chars([CH("a", "본캐", true)]), {goal:5000}, {"lucid:hard":6e7});
  const m = S.merge(st(L([])), remote, null);
  assert.equal(m.state.ledger.budget.total, 300);
  assert.deepEqual(m.state.calc, {goal:5000});
  assert.deepEqual(m.state.prices, {"lucid:hard":6e7});
  assert.equal(m.toRemote, false);
  assert.equal(m.toLocal, true);
  assert.equal(S.empty(st(L([]))), true);
  assert.equal(S.empty(st(L([]), null, null, {})), true);      // 가격 {} 도 없음
  assert.equal(S.empty(st(L([E(1, 1)]))), false);
});

test("첫 연결: 로컬에 기록이 있어도 빈 calc · prices · 예산은 클라우드 것을 씀", () => {
  const local = st(L([E(1, 10)]));
  const remote = st(L([E(7, 99)], {budget:{total:300, cats:{}}}), null, {goal:5000}, {"lucid:hard":6e7});
  const m = S.merge(local, remote, null);
  assert.deepEqual(m.state.calc, {goal:5000});
  assert.deepEqual(m.state.prices, {"lucid:hard":6e7});
  assert.equal(m.state.ledger.budget.total, 300);
  assert.deepEqual(amts(m.state), [10, 99]);
  // 반대로 클라우드 쪽이 비어 있으면 로컬 값
  const m2 = S.merge(st(L([E(1, 10)], {budget:{total:50, cats:{}}}), null, {goal:1}), st(L([])), null);
  assert.equal(m2.state.ledger.budget.total, 50);
  assert.deepEqual(m2.state.calc, {goal:1});
  assert.equal(m2.toRemote, true);
});

test("충돌 기록을 합친 뒤 base 를 받은 클라우드 시점으로 다시 잡고 재시도해도 중복 없음", () => {
  const base0 = S.baseOf(st(L([E(1, 10)])), 1);
  const local = st(L([E(1, 10), E(2, 5)])), remote = st(L([E(1, 10), E(2, 7)]));
  const m = S.merge(local, remote, base0);
  assert.equal(amtIds(m.state), "10#1,7#2,5#3");
  // apply 직후 base = baseOf(받은 클라우드), put 은 아직 안 된 상태에서 로컬에 새 기록이 생김
  const rebase = S.baseOf(remote, 2);
  const applied = structuredClone(m.state);
  applied.ledger.entries.push(E(4, 1)); applied.ledger.seq = 4;
  const again = S.merge(applied, remote, rebase);
  assert.equal(amtIds(again.state), "10#1,7#2,5#3,1#4");
  // put 이 실제로는 성공해 클라우드가 합친 결과인 경우에도 늘어나지 않음
  const again2 = S.merge(applied, structuredClone(m.state), rebase);
  assert.equal(amtIds(again2.state), "10#1,7#2,5#3,1#4");
});

test("put 실패 재시도: base 가 받은 클라우드로 다시 잡혔으면 더 새 원격 수정(12)이 옛 값(11)을 이김", () => {
  const base0 = S.baseOf(st(L([E(1, 10)])), 1);
  const local = st(L([E(1, 10), E(2, 5)])), remote = st(L([E(1, 11), E(2, 7)]));
  const applied = structuredClone(S.merge(local, remote, base0).state);
  assert.equal(amtIds(applied), "11#1,7#2,5#3");
  const remote2 = structuredClone(remote); remote2.ledger.entries[0].a = 12;
  const m = S.merge(applied, remote2, S.baseOf(remote, 2));
  assert.equal(amtIds(m.state), "12#1,7#2,5#3");
  assert.equal(m.state.ledger.entries.length, 3);
});

test("같은 src: 로컬이 지우고 다시 만든 기록 + 클라우드에서 고친 옛 기록 → 하나만 (Z4 회귀 방지)", () => {
  const src = "chk:w:2026-10-22:a1";
  const b1 = st(L([E(5, 1.4, {c:"weekly", src})]));
  const local = st(L([E(8, 1.4, {c:"weekly", src})], {seq:8}));
  const remote = structuredClone(b1); remote.ledger.entries[0].a = 2.0;
  const m = S.merge(local, remote, S.baseOf(b1, 1));
  assert.equal(m.state.ledger.entries.filter(e => e.src === src).length, 1);
  assert.equal(amtIds(m.state), "1.4#8");
});

test("api: 기록이 양쪽에서 따로 생겨도 같은 src 는 하나로", () => {
  const src = "api:pot:2026-10-20:X";
  const b = S.baseOf(st(L([E(1, 1)])), 1);
  const A = st(L([E(1, 1), E(2, 5, {src, est:true})])), B = st(L([E(1, 1), E(2, 5.1, {src, est:true})]));
  const m = S.merge(A, B, b);
  const got = m.state.ledger.entries.filter(e => e.src === src);
  assert.equal(got.length, 1);
  assert.equal(got[0].a, 5);                       // 로컬 것이 남음
  // 첫 연결(base 없음)에서도
  assert.equal(S.merge(A, B, null).state.ledger.entries.filter(e => e.src === src).length, 1);
});

test("api.skip 은 합집합, last 는 키별 최댓값, run 은 더 최근 것 — 지운 API 기록이 부활하지 않음", () => {
  const api = "api:pot:2026-10-20:X";
  const b = S.baseOf(st(L([E(1, 1, {src:api})])), 1);
  const A = st(L([], {api:{last:{}, skip:{[api]:1}, run:null}}));      // A 는 API 기록을 지움 → skip
  const B = st(L([E(1, 1, {src:api})], {api:{last:{pot:"2026-10-25"}, skip:{}, run:"2026-10-25T00:00:00Z"}}));
  const m = S.merge(B, A, b);
  assert.equal(m.state.ledger.entries.length, 0);
  assert.deepEqual(m.state.ledger.api.skip, {[api]:1});
  assert.equal(m.state.ledger.api.last.pot, "2026-10-25");
  assert.equal(m.state.ledger.api.run, "2026-10-25T00:00:00Z");
  // 한쪽이 skip 을 풀면(기록을 되살림) 합집합에서도 빠짐
  const b2 = S.baseOf(st(L([], {api:{last:{}, skip:{[api]:1, "api:x":1}, run:null}})), 1);
  const P = st(L([], {api:{last:{pot:"2026-10-01"}, skip:{"api:x":1}, run:"2026-10-02T00:00:00Z"}}));
  const Q = st(L([], {api:{last:{pot:"2026-10-09"}, skip:{[api]:1, "api:x":1, "api:y":1}, run:"2026-10-01T00:00:00Z"}}));
  const m2 = S.merge(P, Q, b2).state.ledger.api;
  assert.deepEqual(Object.keys(m2.skip).sort(), ["api:x", "api:y"]);
  assert.equal(m2.last.pot, "2026-10-09");
  assert.equal(m2.run, "2026-10-02T00:00:00Z");
});

test("예산 따로 · api 따로 — 한쪽은 예산, 다른 쪽은 api 만 바꿔도 둘 다 반영", () => {
  const f = fork(st(L([E(1, 1)])));
  f.local.ledger.budget = {total:500, cats:{}};
  f.remote.ledger.api = {last:{pot:"2026-10-20"}, skip:{}, run:null};
  const m = S.merge(f.local, f.remote, f.base).state;
  assert.equal(m.ledger.budget.total, 500);
  assert.equal(m.ledger.api.last.pot, "2026-10-20");
});

test("첫 연결: 같은 내용이 여러 건이면 내용별 max(로컬, 클라우드) 건 (2 + 1 → 2, 1 + 2 → 2)", () => {
  const dup = id => E(id, 10, {m:"같은 기록"});
  const m = S.merge(st(L([dup(1), dup(2)])), st(L([dup(7)])), null).state;
  assert.equal(m.ledger.entries.length, 2);
  const m2 = S.merge(st(L([dup(1)])), st(L([dup(7), dup(8)])), null).state;
  assert.equal(m2.ledger.entries.length, 2);
  const m3 = S.merge(st(L([dup(1), dup(2)])), st(L([dup(1), dup(2)])), null);     // 같은 데이터는 그대로
  assert.equal(m3.state.ledger.entries.length, 2);
  assert.equal(m3.toLocal, false);
  assert.equal(m3.toRemote, false);
});

test("본캐가 둘 이상이 되면 하나로 — 이 기기에서 바꾼 쪽, 없으면 앞쪽", () => {
  const start = st(L([]), chars([CH("a", "본캐", true), CH("b", "부캐"), CH("c", "삼캐")]));
  // 로컬에서 c 를 본캐로, 클라우드에서 b 를 본캐로 (a 의 main 은 그대로라 셋이 됨)
  const f = fork(start);
  f.local.chars.list[2].main = true;
  f.remote.chars.list[1].main = true;
  const m = S.merge(f.local, f.remote, f.base).state;
  assert.deepEqual(m.chars.list.filter(c => c.main).map(c => c.id), ["c"]);   // 이 기기에서 바꾼 쪽
  // 로컬이 바꾼 게 없으면 앞쪽
  const g = fork(start);
  g.remote.chars.list[1].main = true; g.remote.chars.list[2].main = true;
  const m2 = S.merge(g.local, g.remote, g.base).state;
  assert.deepEqual(m2.chars.list.filter(c => c.main).map(c => c.id), ["a"]);
  assert.equal(g.remote.chars.list[1].main, true);                            // 입력 객체는 건드리지 않음
});

test("base 형식 버전과 rev — baseOf 가 v · rev 를 담고, 다른 버전 base 는 첫 연결로 취급", () => {
  const s0 = st(L([E(1, 10)]));
  const b = S.baseOf(s0, 7);
  assert.equal(b.v, S.BASE_V);
  assert.equal(b.rev, 7);
  assert.equal(S.BASE_V, 2);
  const stale = Object.assign({}, b, {v: 1});
  // 옛 base 면 첫 연결 경로: 같은 데이터는 쓸 것 없음, 다른 기록은 합침
  const same = S.merge(s0, structuredClone(s0), stale);
  assert.equal(same.toLocal, false);
  assert.equal(same.toRemote, false);
  assert.deepEqual(amts(S.merge(s0, st(L([E(2, 20)])), stale).state), [10, 20]);
  assert.equal(S.hash(S.norm(st(L([E(2, 1), E(1, 2)])))), S.hash(S.norm(st(L([E(1, 2), E(2, 1)])))));
});

test("멱등(예산 · api · 캐릭터 포함) — 같은 데이터 양쪽 + base 없음이면 쓸 것 없음", () => {
  const a = st(L([E(1, 10), E(2, 10)], {budget:{total:5, cats:{x:1}}, api:{last:{pot:"2026-10-01"}, skip:{"api:a":1}, run:"2026-10-01T00:00:00Z"}}),
               chars([CH("a", "본캐", true), CH("b", "부캐")]), {goal:1}, {p:1});
  const once = S.merge(a, structuredClone(a), null);
  assert.equal(once.toLocal, false);
  assert.equal(once.toRemote, false);
  const twice = S.merge(once.state, once.state, S.baseOf(once.state));
  assert.equal(twice.toLocal, false);
  assert.equal(twice.toRemote, false);
});
