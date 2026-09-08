import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatClock12,
  clock12Parts,
  minutesFromClock12,
} from "../lib/hr/time-format.mjs";

test("midnight and noon remain distinct in Arabic twelve-hour display", () => {
  assert.equal(formatClock12(0), "١٢:٠٠ ص");
  assert.equal(formatClock12(720), "١٢:٠٠ م");
  assert.equal(formatClock12(1439), "١١:٥٩ م");
});
test("evening punches display correctly without changing stored minute values", () => {
  assert.equal(formatClock12(965), "٠٤:٠٥ م");
  assert.equal(formatClock12(78), "٠١:١٨ ص");
  assert.equal(formatClock12(1518), "٠١:١٨ ص (+١ يوم)");
  assert.equal(formatClock12(null), "—");
  assert.equal(formatClock12(undefined), "—");
  assert.equal(formatClock12(NaN), "—");
});
test("every schedule minute survives twelve-hour edit and save unchanged", () => {
  for (let value = 0; value < 1440; value++) {
    const { hour, minute, period } = clock12Parts(value);
    assert.equal(minutesFromClock12(hour, minute, period), value);
  }
});
test("invalid twelve-hour values cannot become schedule minutes", () => {
  for (const args of [
    [0, 0, "AM"],
    [13, 0, "PM"],
    [12, 60, "AM"],
    [12, -1, "PM"],
    [4, 5, "invalid"],
  ]) {
    assert.throws(() => minutesFromClock12(...args), RangeError);
  }
});
