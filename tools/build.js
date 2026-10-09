/* src/template.html + data/movies.json + src/engine.js → index.html */
const fs = require("fs");
const path = require("path");
const { ROOT, loadMovies, loadPosters, toRuntime } = require("./lib");
const { validate } = require("./validate");

const movies = loadMovies();
const posters = loadPosters();
const errors = validate(movies, posters);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }

let html = fs.readFileSync(path.join(ROOT, "src/template.html"), "utf8");
const engine = fs.readFileSync(path.join(ROOT, "src/engine.js"), "utf8");
const data = movies.map(m => JSON.stringify({ ...toRuntime(m), i: posters[m.title] || "" })).join(",\n");
// 치환 문자열 안의 $ 패턴이 해석되지 않도록 함수 형태로 치환
html = html.replace("/*__MOVIES__*/[]", () => "[\n" + data + "\n]").replace("/*__ENGINE__*/", () => engine);
html = html.replace("<title>", () => "<!-- 자동 생성 파일: src/·data/를 수정하고 node tools/build.js 를 실행하세요 -->\n<title>");
fs.writeFileSync(path.join(ROOT, "index.html"), html);
console.log(`index.html 생성 (${movies.length}편, 포스터 ${Object.keys(posters).length}편, ${(html.length / 1024).toFixed(0)}KB)`);
