/* 빌드·검증 공용: 어휘 정의와 데이터 로딩 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OTT = { nf: "넷플릭스", tv: "티빙", wv: "웨이브", cp: "쿠팡플레이", dp: "디즈니+", wc: "왓챠", at: "Apple TV", pv: "프라임비디오" };
const MOODS = ["잔잔", "울컥", "유쾌", "긴장", "묵직", "따뜻", "몽환"];
const PRIMARY_GENRES = ["드라마", "로맨스", "코미디", "스릴러", "범죄", "액션", "SF", "판타지", "공포", "애니", "뮤지컬", "전쟁", "모험"];
const SUBGENRES = ["시간여행", "우주", "AI", "디스토피아", "슈퍼히어로", "재난", "괴수", "좀비", "오컬트", "귀신", "연쇄살인", "수사", "심리", "복수", "갱스터", "하이스트", "법정", "사회고발", "정치", "역사극", "전기", "전쟁", "첩보", "성장담", "가족드라마", "멜로", "로맨틱코미디", "블랙코미디", "청춘", "로드무비", "일상", "음악", "예술", "동화", "무협", "스포츠", "힐링", "반전", "고전", "서부", "격투", "휴먼", "모험"];
const REVIEW_TAGS = ["여운", "눈물주의", "호불호", "몰입", "반전충격", "잔잔함", "유쾌함", "불친절", "재관람", "엔딩논쟁", "영상미", "연기", "음악", "불편함", "입문추천"];

function loadMovies() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "data/movies.json"), "utf8"));
}
/* 긴 키 → 앱 내부 짧은 키 */
function toRuntime(m) {
  return { t: m.title, o: m.orig, y: m.year, d: m.director, r: m.runtime, g: m.genres, k: m.keywords, m: m.moods, v: m.reviews, p: m.ott, q: m.quote || "", s: m.synopsis, pg: m.primary, sg: m.subgenres };
}
/* data/posters.json({제목: "/경로.jpg"})은 tools/fetch-posters.js 가 만든다. 없으면 빈 객체 */
function loadPosters() {
  const f = path.join(ROOT, "data/posters.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
}
module.exports = { PRIMARY_GENRES, SUBGENRES, loadPosters, ROOT, OTT, MOODS, REVIEW_TAGS, loadMovies, toRuntime };
