/* TMDB에서 영화 포스터 경로를 받아 data/posters.json 에 저장한다.
 사용: PowerShell  $env:TMDB_KEY="발급받은_v3_API_키"; npm run posters
 - 키는 환경변수로만 받고 파일에 저장하지 않는다.
 - 이미 받은 영화는 건너뛴다(--refresh 로 전체 다시 받기).
 - 자동 매칭이 불확실한 영화는 저장하지 않고 "확인 필요" 목록으로 출력한다. */
const fs = require("fs");
const path = require("path");
const { ROOT, loadMovies } = require("./lib");
const { pickPoster } = require("./tmdb-match");

const KEY = process.env.TMDB_KEY;
if (!KEY) { console.error("TMDB_KEY 환경변수가 없습니다."); process.exit(1); }
const FILE = path.join(ROOT, "data/posters.json");
const refresh = process.argv.includes("--refresh");
const posters = !refresh && fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : {};

/* 자동 매칭이 불확실했지만 후보를 사람이 확인해 승인한 영화(연도가 정확히 같을 때만 후보를 받아들임) */
const APPROVED = new Set(["판의 미로", "내 머릿속의 지우개", "스타워즈: 새로운 희망", "스타워즈: 제국의 역습", "반딧불이의 묘", "원령공주", "불한당"]);
/* TMDB에서 다른 이름으로 올라 있는 영화: 이 원제로 검색하고 대조한다 */
const ORIG_OVERRIDE = { "라이프 이즈 뷰티풀": "La vita è bella" };

async function search(query) {
  const url = "https://api.themoviedb.org/3/search/movie?" + new URLSearchParams({ api_key: KEY, query, language: "ko-KR", include_adult: "false" });
  const res = await fetch(url);
  if (res.status === 401) throw new Error("API 키가 올바르지 않습니다(401).");
  if (res.status === 429) { await new Promise(r => setTimeout(r, 2000)); return search(query); }
  if (!res.ok) throw new Error("TMDB 응답 오류 " + res.status);
  return (await res.json()).results;
}

(async () => {
  const movies = loadMovies();
  const review = [], none = [];
  let done = 0;
  for (const m of movies) {
    if (posters[m.title]) continue;
    const mm = ORIG_OVERRIDE[m.title] ? { ...m, orig: ORIG_OVERRIDE[m.title] } : m;
    let r = pickPoster(mm, await search(mm.orig));
    if (r.status !== "ok") { const r2 = pickPoster(mm, await search(m.title)); if (r2.status === "ok" || (r2.status === "review" && r.status === "none")) r = r2; }
    if (r.status === "review" && APPROVED.has(m.title) && r.year === m.year) r = { ...r, status: "ok" };
    if (r.status === "ok") { posters[m.title] = r.poster; done++; }
    else if (r.status === "review") review.push(`${m.title} (${m.year}) → 후보: ${r.title} / ${r.original} (${r.year}) ${r.poster}`);
    else none.push(m.title);
    await new Promise(res => setTimeout(res, 60));
  }
  const sorted = Object.fromEntries(Object.entries(posters).sort(([a], [b]) => a.localeCompare(b, "ko")));
  fs.writeFileSync(FILE, JSON.stringify(sorted, null, 1) + "\n");
  console.log(`새로 확정 ${done}편, 전체 ${Object.keys(sorted).length}/${movies.length}편 저장`);
  if (review.length) console.log("\n[확인 필요] 자동 매칭이 불확실해 저장하지 않음:\n" + review.join("\n"));
  if (none.length) console.log("\n[결과 없음]\n" + none.join(", "));
})().catch(e => { console.error(e.message); process.exit(1); });
