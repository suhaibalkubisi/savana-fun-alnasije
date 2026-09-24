import { test } from "node:test";
import assert from "node:assert/strict";
import { scopedResult, singleFlight } from "../lib/hr/request-state.mjs";

test("changed filters cannot display or export the previous scope", () => {
  const old = {
    query: "department=a",
    key: "department=a#0",
    data: [1],
    error: "",
  };
  assert.deepEqual(scopedResult(old, "department=b", "department=b#0", true), {
    data: undefined,
    loading: true,
    refreshing: false,
    error: "",
  });
  assert.equal(
    scopedResult(old, "department=a", "department=a#0", false).data,
    undefined,
  );
});
test("background refresh keeps same-scope data without table flicker", () => {
  const old = { query: "a", key: "a#0", data: [1], error: "" };
  assert.deepEqual(scopedResult(old, "a", "a#1", true), {
    data: [1],
    loading: false,
    refreshing: true,
    error: "",
  });
  assert.deepEqual(
    scopedResult(
      { query: "a", key: "a#1", error: "offline" },
      "a",
      "a#1",
      true,
    ),
    { data: undefined, loading: false, refreshing: false, error: "offline" },
  );
});
test("duplicate in-flight submissions share one write; different writes do not", async () => {
  const run = singleFlight();
  let calls = 0;
  const task = async () => ++calls;
  const a = run("same", task),
    b = run("same", task),
    c = run("different", task);
  assert.equal(a, b);
  assert.notEqual(a, c);
  await Promise.all([a, b, c]);
  assert.equal(calls, 2);
  await run("same", task);
  assert.equal(calls, 3);
});
test("failed mutation releases its guard but is never automatically retried", async () => {
  const run = singleFlight();
  let calls = 0;
  await assert.rejects(
    run("a", async () => {
      calls++;
      throw new Error("uncertain");
    }),
    /uncertain/,
  );
  assert.equal(calls, 1);
  await run("a", async () => {
    calls++;
  });
  assert.equal(calls, 2);
});
