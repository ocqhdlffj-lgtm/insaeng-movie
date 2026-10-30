/* API 키 없이 위키백과(영어, 없으면 한국어) 영화 문서의 대표 이미지(대개 포스터)를 data/posters.json 에 채운다.
 사용: node tools/fetch-posters-wiki.js
 - TMDB 포스터가 이미 있는 영화는 건너뛴다. 값은 "https://..." 전체 주소(TMDB는 "/경로.jpg").
 - 문서를 채택하는 조건: 영화 정보 상자가 있고, 제목이 맞고, 감독 이름이 겹치고, 개봉 연도가 ±1년 이내.
 - 조건에 맞지 않으면 저장하지 않고 목록으로 출력한다. */
const fs = require("fs");
const path = require("path");
const { ROOT, loadMovies } = require("./lib");

const FILE = path.join(ROOT, "data/posters.json");
const posters = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : {};
const UA = { "User-Agent": "insaeng-movie-posters/1.0 (https://github.com/ocqhdlffj-lgtm/insaeng-movie)" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const WIDTH = 185;

async function api(lang, params) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`https://${lang}.wikipedia.org/w/api.php?format=json&origin=*&` + new URLSearchParams(params), { headers: UA });
    if (r.ok) return r.json();
    await sleep(2000 * (i + 1));
  }
  throw new Error(lang + " 위키백과 응답 오류");
}
const norm = s => (s || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9가-힣]/g, "");
const hangul = s => (s || "").replace(/[^가-힣]/g, "");
function shares(a, b) { a = hangul(a); b = hangul(b); for (let i = 0; i + 2 <= a.length; i++) if (b.includes(a.slice(i, i + 2))) return true; return false; }

async function tryLang(lang, m) {
  const q = lang === "en" ? `${m.orig} ${m.year} film` : `${m.title} 영화 ${m.year}`;
  const s = await api(lang, { action: "query", list: "search", srsearch: q, srlimit: "4" });
  for (const h of (s.query && s.query.search) || []) {
    if (lang === "en") { const w = norm(m.orig), g = norm(h.title); if (!g || !(g === w || g.includes(w) || w.includes(g))) continue; }
    const p = await api(lang, { action: "query", prop: "revisions|pageimages", rvprop: "content", rvslots: "main", piprop: "thumbnail", pithumbsize: String(WIDTH), titles: h.title });
    const page = Object.values(p.query.pages)[0];
    const txt = (page.revisions && page.revisions[0].slots.main["*"]) || "";
    if (!(lang === "en" ? /[{][{]\s*Infobox film/i : /[{][{]\s*영화[ ]*정보/).test(txt)) continue;
    const thumb = page.thumbnail && page.thumbnail.source;
    if (!thumb) continue;
    const dir = (txt.match(/\|\s*(?:director|감독)\s*=\s*([^\n]+)/i) || [])[1] || "";
    const dirOk = lang === "en"
      ? m.directorEn && dir.toLowerCase().includes(m.directorEn.toLowerCase().split(" ").pop())
      : shares(dir, m.director);
    const years = [...txt.matchAll(/\b(19|20)\d{2}\b/g)].map(x => +x[0]);
    const yearOk = years.some(y => Math.abs(y - m.year) <= 1);
    if (!yearOk) continue;
    // 영어 문서는 감독 영문명을 모르므로 개봉 연도가 정보 상자 앞부분에 있을 때만 채택한다
    if (lang === "ko" && !dirOk) continue;
    if (lang === "en" && !dirOk) {
      const head = txt.slice(0, 2500);
      if (!new RegExp("\\b(" + (m.year - 1) + "|" + m.year + "|" + (m.year + 1) + ")\\b").test(head)) continue;
    }
    return { url: thumb, page: h.title, lang };
  }
  return null;
}

(async () => {
  const movies = loadMovies().filter(m => !posters[m.title]);
  const miss = [];
  let done = 0;
  for (const m of movies) {
    let r = null;
    try { r = await tryLang("en", m) || await tryLang("ko", m); } catch (e) { console.error(m.title, e.message); }
    if (r) { posters[m.title] = r.url; done++; } else miss.push(m.title);
    await sleep(120);
  }
  const sorted = Object.fromEntries(Object.entries(posters).sort(([a], [b]) => a.localeCompare(b, "ko")));
  fs.writeFileSync(FILE, JSON.stringify(sorted, null, 1) + "\n");
  console.log(`위키백과에서 ${done}편 추가, 전체 ${Object.keys(sorted).length}/${loadMovies().length}편`);
  if (miss.length) console.log("\n[못 찾음]\n" + miss.join(", "));
})().catch(e => { console.error(e.message); process.exit(1); });
