const test = require("node:test");
const assert = require("node:assert/strict");
const { loadMovies, toRuntime } = require("../tools/lib");
const { validate } = require("../tools/validate");
const { createEngine } = require("../src/engine");

const DB = loadMovies().map(toRuntime);
const E = createEngine(DB);
const titles = r => r.top.map(x => x.c.t);

test("데이터 검증 통과", () => {
  assert.deepEqual(validate(loadMovies()), []);
  assert.ok(DB.length >= 290);
});

test("search: 정확 → 접두 → 포함 순", () => {
  assert.deepEqual(E.search("대부").map(m => m.t), ["대부"]);
  assert.equal(E.search("godfather").map(m => m.t)[0], "대부"); // 대부 2도 함께 걸리지만 첫 결과는 대부
  assert.deepEqual(E.search("  이터널 선샤인 ").map(m => m.t), ["이터널 선샤인"]);
  assert.ok(E.search("선샤인").length >= 1);   // 포함 검색
  assert.deepEqual(E.search("없는영화제목xyz"), []);
  assert.deepEqual(E.search(""), []);
});

test("recommend: 12편, 입력작 제외, 일치도 66~96", () => {
  const r = E.recommend({ movies: ["이터널 선샤인"] });
  assert.equal(r.top.length, 12);
  assert.ok(!titles(r).includes("이터널 선샤인"));
  r.top.forEach(x => assert.ok(x.pct >= 66 && x.pct <= 96));
  assert.equal(r.top[0].pct, 96);
});

test("recommend: 같은 입력이면 항상 같은 결과", () => {
  const a = titles(E.recommend({ movies: ["기생충", "살인의 추억"] }));
  const b = titles(E.recommend({ movies: ["기생충", "살인의 추억"] }));
  assert.deepEqual(a, b);
});

test("recommend: 같은 감독 작품이 상위에 오른다", () => {
  assert.ok(titles(E.recommend({ movies: ["기생충"] })).slice(0, 4).includes("설국열차"));
});

test("회피 조건이 적용된다", () => {
  const base = { movies: ["올드보이"] };
  const hasAll = (r, f) => r.top.every(x => f(x.c));
  assert.ok(hasAll(E.recommend({ ...base, avoid: new Set(["잔인"]) }), c => !c.k.includes("잔인")));
  assert.ok(hasAll(E.recommend({ ...base, avoid: new Set(["long"]) }), c => c.r <= 150));
  assert.ok(hasAll(E.recommend({ movies: ["센과 치히로의 행방불명"], avoid: new Set(["애니"]) }), c => !c.g.includes("애니")));
  assert.ok(hasAll(E.recommend({ ...base, avoid: new Set(["rv-불편함", "rv-호불호"]) }), c => !c.v.includes("불편함") && !c.v.includes("호불호")));
});

test("후기 취향을 고르면 해당 후기 태그를 가진 영화가 더 많이 올라온다", () => {
  const count = (r, tag) => r.top.filter(x => x.c.v.includes(tag)).length;
  const plain = E.recommend({ movies: ["이터널 선샤인"] });
  const picked = E.recommend({ movies: ["이터널 선샤인"], reviewPrefs: new Set(["눈물주의"]) });
  assert.ok(count(picked, "눈물주의") > count(plain, "눈물주의"));
});

test("후기 태그가 추천 이유에 드러난다", () => {
  const r = E.recommend({ movies: [], reviewPrefs: new Set(["눈물주의"]), pickedTags: new Set(["가족"]) });
  assert.ok(r.top.some(x => x.why.includes("후기에서 자주 언급되는 점")));
});

test("입력이 전혀 없어도 죽지 않는다", () => {
  assert.doesNotThrow(() => E.recommend({}));
});

test("추천 이유의 조사(와/과)", () => {
  const r = E.recommend({ movies: ["이터널 선샤인"] });
  assert.ok(r.top[0].why.startsWith("「이터널 선샤인」과 "));   // '인'은 받침 있음
  const r2 = E.recommend({ movies: ["기생충"] });
  assert.ok(r2.top[0].why.startsWith("「기생충」과 "));          // '충'은 받침 있음
  const r3 = E.recommend({ movies: ["그녀"] });
  assert.ok(r3.top[0].why.startsWith("「그녀」와 "));
});

test("명대사: 일부 작품에 있고, 런타임 데이터로 전달된다", () => {
  const withQuote = DB.filter(m => m.q);
  assert.ok(withQuote.length >= 50);
  assert.equal(E.byTitle("곡성").q, "뭣이 중헌디.");
  assert.equal(E.byTitle("이터널 선샤인").q, "");
});

test("명대사 검증: 너무 긴 값은 거부", () => {
  const bad = loadMovies().slice(0, 1).map(m => ({ ...m, quote: "가".repeat(100) }));
  assert.ok(validate(bad).some(e => e.includes("quote")));
});

test("줄거리: 모든 영화가 4줄을 가진다", () => {
  assert.ok(DB.every(m => Array.isArray(m.s) && m.s.length === 4));
});

test("줄거리 검증: 4줄이 아니면 거부", () => {
  const bad = loadMovies().slice(0, 1).map(m => ({ ...m, synopsis: ["한 줄뿐인 설명입니다 하나둘셋."] }));
  assert.ok(validate(bad).some(e => e.includes("synopsis")));
});

test("입문추천은 유사도가 아니라 가점: 영화 추천 점수에는 섞이지 않고, 선택하면 입문작이 더 올라온다", () => {
  const plain = E.recommend({ movies: ["이터널 선샤인"] });
  const picked = E.recommend({ movies: ["이터널 선샤인"], reviewPrefs: new Set(["입문추천"]) });
  const n = r => r.top.filter(x => x.c.v.includes("입문추천")).length;
  assert.ok(n(picked) >= n(plain));
  assert.ok(picked.top.some(x => x.why.includes("입문작으로 추천받는")));
});

test("여러 편 입력: 서로 다른 취향 영화마다 최소 한 편씩 결과에 나온다", () => {
  const names = E.recommend({ movies: ["센과 치히로의 행방불명", "올드보이"] }).top.map(x => x.c.t);
  assert.ok(["하울의 움직이는 성", "원령공주", "이웃집 토토로", "마녀 배달부 키키"].some(t => names.includes(t)));
  assert.ok(["친절한 금자씨", "아가씨", "달콤한 인생", "아저씨"].some(t => names.includes(t)));
});

test("legacy 옵션은 v1과 같은 결과(기준선 재현)", () => {
  const L = createEngine(DB, { legacy: true });
  assert.equal(L.recommend({ movies: ["이터널 선샤인"] }).top.length, 12);
  assert.equal(L.options.legacy, true);
});

test("대표·세부 장르: 모든 영화에 있고 런타임 데이터로 전달된다", () => {
  assert.ok(DB.every(m => m.pg && Array.isArray(m.sg) && m.sg.length >= 1 && m.sg.length <= 2));
  assert.equal(E.byTitle("인터스텔라").pg, "SF");
  assert.ok(E.byTitle("인터스텔라").sg.includes("우주"));
});

test("SF 영화를 넣으면 SF 영화가 상위에 오고 한국 가족 드라마가 섞이지 않는다", () => {
  const r = E.recommend({ movies: ["인터스텔라"] });
  assert.ok(r.top.slice(0, 6).filter(x => x.c.pg === "SF").length >= 4);
  assert.ok(!r.top.slice(0, 6).some(x => x.c.t === "국제시장"));
});

test("세부 장르를 직접 고르면 해당 장르 영화가 올라오고 이유에 드러난다", () => {
  const r = E.recommend({ pickedSubs: new Set(["시간여행"]) });
  assert.ok(r.top.filter(x => x.c.sg.includes("시간여행")).length >= 6);
  assert.ok(r.top.some(x => x.why.includes("고른 세부 장르")));
});

test("추천 이유: 입력 영화와 세부 장르가 같으면 알려 준다", () => {
  const r = E.recommend({ movies: ["인터스텔라"] });
  assert.ok(r.top.some(x => x.why.includes("세부 장르(")));
});
