/* 줄거리 4줄을 한국어 위키백과 문서와 대조해 의심스러운 영화를 걸러 낸다(최종 판단은 사람이 한다).
 사용: node tools/verify-plot.js [--only 제목1,제목2] [--limit N]
 방식: 감독이 맞는 위키백과 문서를 찾고(동명 영화 제외), 문서 전체와 '줄거리' 절을 가져온다.
       내 줄거리에서 흔하지 않은 낱말(인물·지명·설정 후보)을 뽑아 문서에 있는지 확인한다.
 결과: verify-plot-result.json(커밋하지 않음)과 점수 낮은 순 목록.
 한계: 외래어 표기·문장 바꿔 쓰기 때문에 맞는 영화도 점수가 낮을 수 있다. 점수는 '검토 우선순위'일 뿐 오류 판정이 아니다. */
const fs = require("fs");
const { loadMovies } = require("./lib");

const UA = { "User-Agent": "insaeng-movie-verify/1.0 (https://github.com/ocqhdlffj-lgtm/insaeng-movie)" };
const TPL = /[{][{][ ]*영화[ ]*정보/; // 문서마다 {{영화정보 또는 {{영화 정보
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hangul = s => (s || "").replace(/[^가-힣]/g, "");

async function api(params) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch("https://ko.wikipedia.org/w/api.php?format=json&origin=*&" + new URLSearchParams(params), { headers: UA });
      if (r.ok) return r.json();
    } catch (e) { /* 재시도 */ }
    await sleep(1500 * (i + 1));
  }
  throw new Error("위키백과 요청 실패");
}

function shares(a, b) { // 2글자 이상 연속으로 겹치는가(외래어 표기 차이 흡수)
  a = hangul(a); b = hangul(b);
  for (let i = 0; i + 2 <= a.length; i++) if (b.includes(a.slice(i, i + 2))) return true;
  return false;
}

/* 위키 문법 제거 */
function clean(t) {
  return t
    .replace(/<ref[^>]*\/>/g, " ") // 자체 닫힘 각주를 먼저 지운다(안 그러면 다음 </ref>까지 본문이 삭제됨)
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\{\{[^{}]*\}\}/g, " ").replace(/\{\{[^{}]*\}\}/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/'''?/g, "").replace(/\[https?:[^\s\]]+\s?([^\]]*)\]/g, "$1");
}

async function plotFor(m) {
  const s = await api({ action: "query", list: "search", srsearch: `${m.title} 영화 ${m.year}`, srlimit: "4" });
  for (const h of (s.query && s.query.search) || []) {
    const p = await api({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", titles: h.title });
    const page = Object.values(p.query.pages)[0];
    const txt = (page.revisions && page.revisions[0].slots.main["*"]) || "";
    if (!TPL.test(txt)) continue;
    const tt = hangul(h.title.replace(/[(][^)]*[)]/g, "")), mt = hangul(m.title.replace(/[(][^)]*[)]/g, ""));
    if (tt && mt && !(tt.includes(mt) || mt.includes(tt))) continue; // 제목이 다른 문서는 제외
    const dir = (txt.match(/\|\s*감독\s*=\s*([^\n]+)/) || [])[1] || "";
    if (!shares(dir, m.director)) continue;
    const sec = txt.match(/==\s*(?:줄거리|개요|시놉시스|내용)\s*==([\s\S]*?)(?:\n==[^=]|$)/);
    return { page: h.title, plot: clean(sec ? sec[1] : ""), whole: clean(txt) };
  }
  return null;
}

const PARTICLES = /(은|는|이|가|을|를|의|와|과|도|에|에서|에게|으로|로|까지|부터|만|이다|한다|된다|하는|하며|하고|했다|이며|인|으로서|처럼)$/;
const stem = w => { let x = w; for (let i = 0; i < 2; i++) x = x.replace(PARTICLES, ""); return x.length >= 2 ? x : w; };
const VERBISH = /(다|며|고|서|해|한|는|어|진|던|운|된|려|면|듯|게|지|니|라|자|네|요|도록|으며|면서|하며|하고|하려|하는|이다|입니다)$/;
const words = s => (s.match(/[가-힣]{2,}/g) || []).map(stem).filter(w => w.length >= 2 && !VERBISH.test(w));

function score(m, ref, df) {
  const text = (m.synopsis || []).join(" ");
  const mine = [...new Set(words(text))];
  const rare = mine.filter(w => (df[w] || 0) <= 2); // 인물·지명·설정 후보
  const hay = hangul(ref.whole + " " + ref.plot);
  const inHay = w => hay.includes(w);
  const rareMissing = rare.filter(w => !inHay(w));
  const allMissing = mine.filter(w => !inHay(w));
  // 줄 단위: 희소어(흔하지 않은 낱말)가 2개 이상인데 위키백과와 하나도 안 겹치면 그 줄을 의심으로 표시
  const lines = (m.synopsis || []).map((ln, i) => {
    const lw = [...new Set(words(ln))].filter(w => (df[w] || 0) <= 3);
    const miss = lw.filter(w => !inHay(w));
    const found = lw.length - miss.length;
    return { n: i + 1, rare: lw.length, found, miss, flag: lw.length >= 2 && found === 0 };
  });
  return {
    rareTotal: rare.length, rareMissing, rateRare: rare.length ? 1 - rareMissing.length / rare.length : 1,
    rateAll: mine.length ? 1 - allMissing.length / mine.length : 1,
    plotChars: ref.plot.length, lines, flaggedLines: lines.filter(l => l.flag).map(l => l.n),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
  const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1], 10) : Infinity;
  const all = loadMovies();
  // 낱말 문서빈도: 전체 영화 줄거리에서 몇 편에 나오는지
  const df = {};
  all.forEach(m => new Set(words((m.synopsis || []).join(" "))).forEach(w => df[w] = (df[w] || 0) + 1));
  const movies = (only ? all.filter(m => only.includes(m.title)) : all).slice(0, limit);
  const out = {};
  for (let i = 0; i < movies.length; i++) {
    const m = movies[i];
    const ref = await plotFor(m).catch(() => null);
    await sleep(200);
    if (!ref) { out[m.title] = { status: "문서없음" }; continue; }
    const sc = score(m, ref, df);
    out[m.title] = { status: "대조", page: ref.page, ...sc, excerpt: ref.plot.replace(/\s+/g, " ").slice(0, 700) };
    if ((i + 1) % 50 === 0) console.error(`진행 ${i + 1}/${movies.length}`);
  }
  fs.writeFileSync("verify-plot-result.json", JSON.stringify(out, null, 1));
  const rows = Object.entries(out);
  const cmp = rows.filter(([, r]) => r.status === "대조");
  console.log(`대조 ${cmp.length}편, 문서 없음 ${rows.length - cmp.length}편`);
  const avg = cmp.reduce((s, [, r]) => s + r.rateRare, 0) / (cmp.length || 1);
  console.log(`희소어 일치율 평균 ${(avg * 100).toFixed(0)}%`);
  const flagged = cmp.filter(([, r]) => r.flaggedLines.length);
  console.log(`\n[의심 줄이 있는 영화 ${flagged.length}편] (희소어 2개 이상인 줄이 위키백과와 하나도 안 겹침)`);
  flagged.sort((a, b) => b[1].flaggedLines.length - a[1].flaggedLines.length || a[1].rateRare - b[1].rateRare)
    .forEach(([t, r]) => console.log(`${t} (${(r.rateRare * 100).toFixed(0)}%) 줄 ${r.flaggedLines.join(",")}: ` + r.lines.filter(l => l.flag).map(l => l.miss.join("/")).join(" | ")));
  const none = rows.filter(([, r]) => r.status !== "대조").map(([t]) => t);
  if (none.length) console.log(`\n[문서 없음 ${none.length}편] ` + none.join(", "));
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { score, words, plotFor, clean };
