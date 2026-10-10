const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluate } = require("../tools/evaluate");

/* 기본 엔진이 v1(legacy)보다 나빠지지 않았는지 지키는 보호 테스트.
 평가 세트가 작아(입력 42개, 혼합 8개) 작은 변동은 잡음이므로 recall에만 소폭 허용 오차를 둔다. */
const legacy = evaluate({ legacy: true }, true);
const current = evaluate({}, true);

test("평가: 한 편이라도 맞히는 비율(hit)이 v1보다 낮아지지 않는다", () => {
  assert.ok(current.hit >= legacy.hit, `hit ${current.hit} < ${legacy.hit}`);
});

test("평가: 첫 적중 순위(mrr)가 v1보다 낮아지지 않는다", () => {
  assert.ok(current.mrr >= legacy.mrr, `mrr ${current.mrr} < ${legacy.mrr}`);
});

test("평가: 여러 편 입력 시 입력마다 기대 영화가 나오는 비율(coverage)이 v1보다 낮아지지 않는다", () => {
  assert.ok(current.coverage >= legacy.coverage, `coverage ${current.coverage} < ${legacy.coverage}`);
});

test("평가: recall은 v1 대비 0.03 이상 떨어지지 않는다", () => {
  assert.ok(current.recall >= legacy.recall - 0.03, `recall ${current.recall} vs ${legacy.recall}`);
});
