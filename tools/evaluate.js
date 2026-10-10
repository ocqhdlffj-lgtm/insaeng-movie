/* 추천 엔진 평가: test/eval-pairs.json 의 "비슷한 영화" 기대 목록 대비 결과를 점수화한다.
 사용: node tools/evaluate.js [옵션JSON]   예) node tools/evaluate.js {"idf":0,"mmr":0}
 지표(높을수록 좋음, 12편 안에서 평가)
  recall   : 기대 영화 중 추천 12편에 들어온 비율의 평균
  hit      : 기대 영화가 하나라도 들어온 입력의 비율
  mrr      : 첫 기대 영화의 순위 역수 평균(1위=1, 12위=1/12)
  coverage : (여러 편 입력) 입력마다 기대 영화가 최소 하나씩 들어온 비율
 참고 지표: dirDup = 한 결과 안에서 같은 감독이 중복된 수의 평균(낮을수록 다양) */
const fs = require("fs");
const path = require("path");
const { ROOT, loadMovies, toRuntime } = require("./lib");
const { createEngine } = require("../src/engine");

function evaluate(opts = {}, quiet = false) {
  const DB = loadMovies().map(toRuntime);
  const E = createEngine(DB, opts);
  const set = JSON.parse(fs.readFileSync(path.join(ROOT, "test/eval-pairs.json"), "utf8"));
  const titles = new Set(DB.map(m => m.t));
  const missing = [];
  const chk = a => a.forEach(t => titles.has(t) || missing.push(t));
  set.seeds.forEach(s => { chk(s.input); chk(s.similar); });
  set.mixed.forEach(s => { chk(s.inputs); s.groups.forEach(chk); });
  if (missing.length) throw new Error("평가 세트에 없는 영화: " + [...new Set(missing)].join(", "));

  let recall = 0, hit = 0, mrr = 0, dirDup = 0;
  const rows = [];
  for (const s of set.seeds) {
    const top = E.recommend({ movies: s.input }).top.map(x => x.c);
    const names = top.map(c => c.t);
    const ranks = s.similar.map(t => names.indexOf(t)).filter(i => i >= 0);
    recall += ranks.length / s.similar.length;
    hit += ranks.length ? 1 : 0;
    mrr += ranks.length ? 1 / (Math.min(...ranks) + 1) : 0;
    dirDup += top.length - new Set(top.map(c => c.d)).size;
    rows.push({ input: s.input[0], found: ranks.length, of: s.similar.length });
  }
  let cov = 0;
  const mixedRows = [];
  for (const m of set.mixed) {
    const names = E.recommend({ movies: m.inputs }).top.map(x => x.c.t);
    const per = m.groups.map(g => g.some(t => names.includes(t)));
    cov += per.every(Boolean) ? 1 : 0;
    mixedRows.push({ inputs: m.inputs.join(" + "), per });
  }
  const n = set.seeds.length;
  const result = { recall: recall / n, hit: hit / n, mrr: mrr / n, coverage: cov / set.mixed.length, dirDup: dirDup / n };
  if (!quiet) {
    rows.filter(r => r.found === 0).forEach(r => console.log("  놓침:", r.input));
    mixedRows.filter(r => !r.per.every(Boolean)).forEach(r => console.log("  한쪽만:", r.inputs, r.per.map(b => (b ? "O" : "X")).join("")));
  }
  return result;
}

if (require.main === module) {
  const opts = process.argv[2] ? JSON.parse(process.argv[2]) : {};
  const r = evaluate(opts);
  const f = x => x.toFixed(3);
  console.log(`recall ${f(r.recall)}  hit ${f(r.hit)}  mrr ${f(r.mrr)}  coverage ${f(r.coverage)}  dirDup ${f(r.dirDup)}`);
}
module.exports = { evaluate };
