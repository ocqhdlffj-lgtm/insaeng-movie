/* 영화 메타데이터(연도·상영시간·감독)를 외부 자료와 대조해 틀린 값을 찾는다.
 사용: node tools/verify.js                 data/movies.json 전체 검증
       node tools/verify.js 파일.jsonl      한 줄에 영화 하나인 파일(새 영화를 합치기 전 검증)
 출처 3곳: Wikidata(영문 원제 → 한국어 제목 순), 한국어 위키백과·영어 위키백과 정보 상자.
 판정: 연도는 ±1년까지 같은 영화로 보고(개봉·영화제 시차), 감독이 다른 동명 영화는 제외한다.
       내 상영시간이 어느 출처와 4분 안이면 '일치', 아니면서 2곳 이상이 같은 값이면 '수정권고', 그 외는 '수동확인'.
 한계: 자료에 없거나 이름이 다르면 '미확인'(틀렸다는 뜻이 아님). 줄거리·명대사는 검증하지 못한다. */
const fs = require("fs");
const { loadMovies, ROOT } = require("./lib");
const path = require("path");
/* 사람이 확인해 현재 값을 유지하기로 한 영화(이유 포함). 외부 자료와 달라도 '확인됨'으로 센다 */
const NOTES = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "data/verify-notes.json"), "utf8")); } catch (e) { return {}; } })();

const UA = { "User-Agent": "insaeng-movie-verify/1.0 (https://github.com/ocqhdlffj-lgtm/insaeng-movie)", Accept: "application/sparql-results+json" };
const esc = s => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sparql(q) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), { headers: UA });
    if (res.ok) return (await res.json()).results.bindings;
    if (res.status === 429 || res.status >= 500) { await sleep(3000 * (i + 1)); continue; }
    throw new Error("Wikidata " + res.status);
  }
  throw new Error("Wikidata 재시도 초과");
}

/* labels: 검색할 제목들, lang: 'en' | 'ko' → {소문자제목: [{year,dur,dirKo,dirEn}]} */
async function lookup(labels, lang) {
  const out = {};
  for (let i = 0; i < labels.length; i += 30) {
    const chunk = labels.slice(i, i + 30);
    const values = chunk.map(l => `"${esc(l)}"@${lang}`).join(" ");
    const q = `SELECT ?label ?item (MIN(?date) AS ?d) (SAMPLE(?dur) AS ?dur) (GROUP_CONCAT(DISTINCT ?dko; separator="|") AS ?dirKo) (GROUP_CONCAT(DISTINCT ?den; separator="|") AS ?dirEn) WHERE {
      VALUES ?label { ${values} }
      ?item rdfs:label ?label . ?item wdt:P31/wdt:P279* wd:Q11424 .
      OPTIONAL { ?item wdt:P577 ?date } OPTIONAL { ?item wdt:P2047 ?dur }
      OPTIONAL { ?item wdt:P57 ?dir . OPTIONAL { ?dir rdfs:label ?dko FILTER(lang(?dko)="ko") } OPTIONAL { ?dir rdfs:label ?den FILTER(lang(?den)="en") } }
    } GROUP BY ?label ?item`;
    for (const b of await sparql(q)) {
      const k = b.label.value.toLowerCase();
      (out[k] = out[k] || []).push({
        year: b.d ? parseInt(b.d.value.slice(0, 4), 10) : null,
        dur: b.dur ? Math.round(parseFloat(b.dur.value)) : null,
        dirKo: b.dirKo ? b.dirKo.value.split("|").filter(Boolean) : [],
        dirEn: b.dirEn ? b.dirEn.value.split("|").filter(Boolean) : [],
      });
    }
    await sleep(800);
  }
  return out;
}

const hangulOnly = s => (s || "").replace(/[^가-힣]/g, "");
function sharesChunk(a, b) { // 두 한글 문자열이 2글자 이상 연속으로 겹치는가(외래어 표기 차이 흡수)
  a = hangulOnly(a); b = hangulOnly(b);
  for (let i = 0; i + 2 <= a.length; i++) if (b.includes(a.slice(i, i + 2))) return true;
  return false;
}

function judge(m, cands) {
  const near = (cands || []).filter(c => c.year && Math.abs(c.year - m.year) <= 1);
  if (!near.length) return { status: "미확인", note: cands && cands.length ? "연도 불일치 후보: " + cands.map(c => c.year).join(",") : "검색 결과 없음" };
  // 감독이 다른 동명 영화는 제외(예: The Tower 2012 독일 영화)
  const dirOk = c => (c.dirKo.length ? c.dirKo.some(d => sharesChunk(d, m.director)) : null);
  const pool = near.filter(c => dirOk(c) !== false);
  if (!pool.length) return { status: "미확인", note: "같은 제목의 다른 영화만 발견: " + near.map(c => c.dirEn.join("/") || "?").join(", ") };
  pool.sort((x, y) => (dirOk(y) === true) - (dirOk(x) === true) || Math.abs(x.year - m.year) - Math.abs(y.year - m.year) || (y.dur ? 1 : 0) - (x.dur ? 1 : 0));
  const c = pool[0], issues = [];
  if (c.year !== m.year) issues.push(`연도 ${m.year}→Wikidata ${c.year}`);
  if (c.dur && Math.abs(c.dur - m.runtime) >= 5) issues.push(`상영시간 ${m.runtime}→Wikidata ${c.dur}`);
  return { status: issues.length ? "의심" : "일치", issues, cand: c, dirChecked: dirOk(c) === true };
}

/* 2차: 한국어 위키백과 정보 상자(상영 시간·감독·개봉). 감독이 맞는 문서만 채택 */
async function wikiApi(params) {
  const r = await fetch("https://ko.wikipedia.org/w/api.php?format=json&origin=*&" + new URLSearchParams(params), { headers: { "User-Agent": UA["User-Agent"] } });
  return r.json();
}
async function koWiki(m) {
  const s = await wikiApi({ action: "query", list: "search", srsearch: `${m.title} 영화 ${m.year}`, srlimit: "4" });
  for (const h of (s.query && s.query.search) || []) {
    const p = await wikiApi({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", titles: h.title });
    const page = Object.values(p.query.pages)[0];
    const txt = (page.revisions && page.revisions[0].slots.main["*"]) || "";
    if (!txt.includes("{{영화정보")) continue;
    const dirLine = (txt.match(/\|\s*감독\s*=\s*([^\n]+)/) || [])[1] || "";
    if (!sharesChunk(dirLine, m.director)) continue;
    const rt = (txt.match(/\|\s*(?:상영\s*시간|시간)\s*=\s*(\d+)\s*분/) || [])[1];
    const yr = (txt.match(/\|\s*개봉\s*=[^\n]*?(\d{4})년/) || [])[1];
    return { page: h.title, runtime: rt ? parseInt(rt, 10) : null, year: yr ? parseInt(yr, 10) : null };
  }
  return null;
}

/* 3차: 영어 위키백과 정보 상자. 극장 개봉판과 감독판이 함께 적히므로 값을 모두 모은다 */
async function enApi(params) {
  const r = await fetch("https://en.wikipedia.org/w/api.php?format=json&origin=*&" + new URLSearchParams(params), { headers: { "User-Agent": UA["User-Agent"] } });
  return r.json();
}
const normEn = s => (s || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");
async function enWiki(m) {
  const s = await enApi({ action: "query", list: "search", srsearch: `${m.orig} ${m.year} film`, srlimit: "4" });
  for (const h of (s.query && s.query.search) || []) {
    const want = normEn(m.orig), got = normEn(h.title);
    if (!got || !(got === want || got.includes(want) || want.includes(got))) continue; // 제목이 다른 문서는 제외
    const p = await enApi({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", titles: h.title });
    const page = Object.values(p.query.pages)[0];
    const txt = (page.revisions && page.revisions[0].slots.main["*"]) || "";
    if (!/\{\{\s*Infobox film/i.test(txt)) continue;
    const rel = (txt.match(/\|\s*released\s*=([^\n]+)/i) || [])[1] || "";
    const y = (rel.match(/(?:19|20)\d\d/) || [])[0];
    if (y && Math.abs(+y - m.year) > 1) continue;
    const rt = (txt.match(/\|\s*runtime\s*=\s*([^\n]+)/i) || [])[1] || "";
    const nums = [...rt.matchAll(/(\d+)\s*(?:minutes|min)/gi)].map(x => +x[1]);
    const dm = rt.match(/\{\{\s*(?:Duration|Runtime)[^}]*?m\s*=\s*(\d+)/i);
    return { page: h.title, runtimes: nums.length ? nums : dm ? [+dm[1]] : [] };
  }
  return null;
}

/* 출처별 상영시간을 모아 투표한다. 내 값이 어느 출처와 4분 이내면 일치, 아니면 2곳 이상이 모인 값을 수정 권고로 낸다 */
function decide(m, src) {
  const vals = []; // {v, from}
  if (src.wd && src.wd.dur >= 40 && src.wd.dur <= 400) vals.push({ v: src.wd.dur, from: "Wikidata" });
  if (src.ko && src.ko.runtime) vals.push({ v: src.ko.runtime, from: "위키백과(ko)" });
  if (src.en) src.en.runtimes.forEach((v, i) => vals.push({ v, from: "위키백과(en)" + (i ? "·다른 판" : "") }));
  const hit = vals.find(x => Math.abs(x.v - m.runtime) <= 4);
  if (hit) return { status: "일치", note: hit.from + " " + hit.v + "분" };
  if (!vals.length) return { status: "미확인", note: "출처에서 상영시간을 찾지 못함" };
  // 서로 3분 이내인 값이 가장 많이 모인 군집(서로 다른 출처만 센다)
  let best = null;
  for (const x of vals) {
    const grp = vals.filter(y => Math.abs(y.v - x.v) <= 3);
    const nsrc = new Set(grp.map(g => g.from.replace("·다른 판", ""))).size;
    if (!best || nsrc > best.nsrc) best = { v: x.v, nsrc, grp };
  }
  const list = vals.map(x => x.from + " " + x.v).join(", ");
  if (best.nsrc >= 2) return { status: "수정권고", suggest: best.v, note: `${m.runtime}→${best.v} (${best.nsrc}곳 합의: ${list})` };
  return { status: "수동확인", note: `${m.runtime}분 vs ${list}` };
}

async function verify(movies) {
  const byEn = await lookup([...new Set(movies.map(m => m.orig))], "en");
  const wd = new Map(), retry = [];
  movies.forEach(m => { const r = judge(m, byEn[m.orig.toLowerCase()]); if (r.status === "미확인") retry.push(m); else wd.set(m.title, r); });
  if (retry.length) {
    const byKo = await lookup([...new Set(retry.map(m => m.title))], "ko");
    retry.forEach(m => wd.set(m.title, judge(m, byKo[m.title.toLowerCase()])));
  }
  const result = new Map();
  for (const m of movies) {
    const w = wd.get(m.title);
    const yearIssue = w.issues ? w.issues.filter(i => i.startsWith("연도")) : [];
    const src = { wd: w.cand || null };
    // Wikidata 값이 이미 맞으면 위키백과 호출을 건너뛰어 시간을 아낀다
    if (!(src.wd && src.wd.dur && Math.abs(src.wd.dur - m.runtime) <= 4)) {
      src.ko = await koWiki(m).catch(() => null); await sleep(250);
      src.en = await enWiki(m).catch(() => null); await sleep(250);
    }
    const d = decide(m, src);
    if (yearIssue.length) d.yearNote = yearIssue.join(", ");
    if (NOTES[m.title]) { // 사람이 확인한 예외
      if (d.status !== "일치") d.status = "일치";
      d.note = "확인됨(예외): " + NOTES[m.title];
      delete d.yearNote;
    }
    result.set(m.title, d);
  }
  return result;
}

if (require.main === module) {
  const file = process.argv.slice(2).find(a => !a.startsWith("--"));
  const movies = file ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : loadMovies();
  verify(movies).then(res => {
    const rows = [...res.entries()];
    const by = s => rows.filter(([, r]) => r.status === s);
    console.log(`검증 ${rows.length}편: 일치 ${by("일치").length}, 수정권고 ${by("수정권고").length}, 수동확인 ${by("수동확인").length}, 미확인 ${by("미확인").length}`);
    const yr = rows.filter(([, r]) => r.yearNote);
    if (yr.length) console.log("\n[연도 의심]\n" + yr.map(([t, r]) => t + ": " + r.yearNote).join("\n"));
    if (by("수정권고").length) console.log("\n[수정권고]\n" + by("수정권고").map(([t, r]) => t + ": " + r.note).join("\n"));
    if (by("수동확인").length) console.log("\n[수동확인]\n" + by("수동확인").map(([t, r]) => t + ": " + r.note).join("\n"));
    if (by("미확인").length) console.log("\n[미확인]\n" + by("미확인").map(([t, r]) => t + " (" + r.note + ")").join("\n"));
    if (process.argv.includes("--json")) fs.writeFileSync("verify-result.json", JSON.stringify(Object.fromEntries(rows), null, 1));
  }).catch(e => { console.error(e.message); process.exit(1); });
}
module.exports = { verify, judge };
