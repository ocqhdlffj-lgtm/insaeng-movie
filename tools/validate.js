/* data/movies.json 검증: 스키마, 어휘, 중복. 문제가 있으면 종료 코드 1 */
const { OTT, MOODS, REVIEW_TAGS, PRIMARY_GENRES, SUBGENRES, loadMovies, loadPosters } = require("./lib");

function validate(movies, posters = {}) {
  const errors = [];
  const seen = new Set();
  const token = s => typeof s === "string" && s.length > 0 && !/\s/.test(s);
  movies.forEach((m, i) => {
    const id = `#${i + 1} ${m.title}`;
    const err = msg => errors.push(`${id}: ${msg}`);
    for (const f of ["title", "orig", "director"]) if (typeof m[f] !== "string" || !m[f]) err(`${f} 누락`);
    if (!Number.isInteger(m.year) || m.year < 1890 || m.year > 2100) err("year 비정상");
    if (!Number.isInteger(m.runtime) || m.runtime < 30 || m.runtime > 300) err("runtime 비정상");
    for (const f of ["genres", "keywords", "moods", "reviews", "ott"]) {
      if (!Array.isArray(m[f])) { err(`${f}는 배열이어야 함`); continue; }
      if (!m[f].every(token)) err(`${f}에 공백이 든 값이 있음`);
      if (new Set(m[f]).size !== m[f].length) err(`${f}에 중복`);
    }
    if (m.genres?.length < 1) err("장르 없음");
    if (m.keywords?.length < 3) err("키워드 3개 미만");
    if (m.moods?.length < 1) err("분위기 없음");
    m.moods?.forEach(x => MOODS.includes(x) || err(`알 수 없는 분위기: ${x}`));
    if (m.reviews?.length < 2 || m.reviews?.length > 5) err("후기 태그는 2~5개");
    m.reviews?.forEach(x => REVIEW_TAGS.includes(x) || err(`알 수 없는 후기 태그: ${x}`));
    m.ott?.forEach(x => OTT[x] || err(`알 수 없는 OTT 코드: ${x}`));
    if (!Array.isArray(m.synopsis) || m.synopsis.length !== 4) err("synopsis는 4줄 배열이어야 함");
    else m.synopsis.forEach((s, j) => { if (typeof s !== "string" || s.length < 8 || s.length > 110) err("synopsis " + (j + 1) + "번째 줄 길이 비정상"); });
    if (!PRIMARY_GENRES.includes(m.primary)) err("primary(대표 장르)가 없거나 목록에 없음: " + m.primary);
    if (!Array.isArray(m.subgenres) || m.subgenres.length < 1 || m.subgenres.length > 2) err("subgenres(세부 장르)는 1~2개");
    else m.subgenres.forEach(x => SUBGENRES.includes(x) || err("알 수 없는 세부 장르: " + x));
    if (m.quote !== undefined && (typeof m.quote !== "string" || m.quote.length < 2 || m.quote.length > 90)) err("quote는 2~90자 문자열");
    if (seen.has(m.title)) err("제목 중복");
    seen.add(m.title);
  });
  const titles = new Set(movies.map(m => m.title));
  for (const [t, p] of Object.entries(posters)) {
    if (!titles.has(t)) errors.push("posters.json: 없는 영화 " + t);
    else if (!/^\/[A-Za-z0-9_-]+\.jpg$/.test(p)) errors.push("posters.json: 경로 형식 오류 " + t + " " + p);
  }
  return errors;
}

if (require.main === module) {
  const movies = loadMovies();
  const errors = validate(movies, loadPosters());
  if (errors.length) { console.error(errors.join("\n")); console.error(`\n오류 ${errors.length}건`); process.exit(1); }
  console.log(`OK: ${movies.length}편 검증 통과`);
}
module.exports = { validate };
