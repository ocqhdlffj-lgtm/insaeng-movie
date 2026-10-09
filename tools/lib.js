/* 빌드·검증 공용: 어휘 정의와 데이터 로딩 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OTT = { nf: "넷플릭스", tv: "티빙", wv: "웨이브", cp: "쿠팡플레이", dp: "디즈니+", wc: "왓챠", at: "Apple TV", pv: "프라임비디오" };
const MOODS = ["잔잔", "울컥", "유쾌", "긴장", "묵직", "따뜻", "몽환"];
const REVIEW_TAGS = ["여운", "눈물주의", "호불호", "몰입", "반전충격", "잔잔함", "유쾌함", "불친절", "재관람", "엔딩논쟁", "영상미", "연기", "음악", "불편함", "입문추천"];

function loadMovies() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "data/movies.json"), "utf8"));
}
/* 긴 키 → 앱 내부 짧은 키 */
function toRuntime(m) {
  return { t: m.title, o: m.orig, y: m.year, d: m.director, r: m.runtime, g: m.genres, k: m.keywords, m: m.moods, v: m.reviews, p: m.ott, q: m.quote || "", s: m.synopsis };
}
/* data/posters.json({제목: "/경로.jpg"})은 tools/fetch-posters.js 가 만든다. 없으면 빈 객체 */
function loadPosters() {
  const f = path.join(ROOT, "data/posters.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
}
module.exports = { loadPosters, ROOT, OTT, MOODS, REVIEW_TAGS, loadMovies, toRuntime };
