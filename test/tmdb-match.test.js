const test = require("node:test");
const assert = require("node:assert/strict");
const { pickPoster } = require("../tools/tmdb-match");

const movie = { title: "기생충", orig: "Parasite", year: 2019 };
const hit = (o = {}) => ({ id: 1, title: "기생충", original_title: "기생충", release_date: "2019-05-30", poster_path: "/a.jpg", ...o });

test("연도와 제목이 맞으면 확정", () => {
  const r = pickPoster(movie, [hit()]);
  assert.equal(r.status, "ok");
  assert.equal(r.poster, "/a.jpg");
});

test("동명 영화는 연도가 맞는 쪽을 고른다", () => {
  const r = pickPoster(movie, [hit({ id: 2, release_date: "1999-01-01", poster_path: "/old.jpg" }), hit({ id: 3, poster_path: "/new.jpg" })]);
  assert.equal(r.poster, "/new.jpg");
});

test("포스터가 없는 후보는 무시", () => {
  assert.equal(pickPoster(movie, [hit({ poster_path: null })]).status, "none");
});

test("제목도 연도도 안 맞으면 확정하지 않는다", () => {
  const r = pickPoster(movie, [hit({ title: "다른 영화", original_title: "Other", release_date: "2005-01-01" })]);
  assert.notEqual(r.status, "ok");
});

test("연도가 1년 어긋나도 제목이 맞으면 확정(영화제·개봉 시차)", () => {
  assert.equal(pickPoster(movie, [hit({ release_date: "2018-12-31" })]).status, "ok");
});

test("결과가 없으면 none", () => {
  assert.equal(pickPoster(movie, []).status, "none");
});
