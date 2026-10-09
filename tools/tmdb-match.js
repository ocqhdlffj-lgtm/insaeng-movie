/* TMDB 검색 결과에서 우리 영화와 같은 작품을 고르는 순수 함수(네트워크 없음, 테스트 가능) */
const norm = s => String(s || "").toLowerCase().replace(/[\s:·\-!?.,'’"“”()&]/g, "");

/* movie: {title, orig, year}, results: TMDB /search/movie 결과 배열 */
function pickPoster(movie, results) {
  let best = null;
  for (const r of results || []) {
    if (!r.poster_path) continue;
    const ry = parseInt((r.release_date || "").slice(0, 4), 10);
    let score = 0;
    if (ry === movie.year) score += 3;
    else if (Math.abs(ry - movie.year) === 1) score += 1;
    else if (ry) score -= 2;
    if (norm(r.original_title) === norm(movie.orig)) score += 3;
    if (norm(r.title) === norm(movie.title)) score += 3;
    if (!best || score > best.score) best = { score, id: r.id, poster: r.poster_path, title: r.title, original: r.original_title, year: ry };
  }
  if (!best) return { status: "none" };
  // 확정: 연도 일치(±1) + 제목 일치 / 확인 필요: 그 외
  return best.score >= 4 ? { status: "ok", ...best } : { status: "review", ...best };
}

module.exports = { pickPoster, norm };
