import assert from "node:assert/strict";
import { test } from "node:test";
import { duration, quotaGroups, quotaTiming } from "./quota.js";

const HOUR = 3_600_000;
const now = Date.parse("2026-11-24T12:00:00Z");
const reset = new Date(now + 3 * HOUR).toISOString();

test("selects only the standard Claude and Codex quota meters", () => {
  const window = { kind: "session", remainingPercent: 20, resetsAt: reset };
  const groups = quotaGroups({ limits: { providers: [
    { provider: "copilot", windows: [window] },
    { provider: "claude", windows: [
      window, { ...window, remainingPercent: null }, { ...window, metric: "spend" },
      { ...window, kind: "weekly", remainingPercent: 0 },
    ] },
    { provider: "codex", windows: [
      { ...window, additional: true }, { ...window, windowMinutes: 240 },
    ] },
  ] } });
  assert.deepEqual(groups.map(({ id, label, rows }) => [id, label, rows.map((row) => [row.label, row.left])]),
    [["claude", "Claude", [["5h", 20], ["7d", 0]]], ["codex", "OpenAI", [["4h", 20]]]]);
  assert.throws(() => quotaGroups({}));
});

test("projects even use and exhaustion only when the window supports it", () => {
  const row = { left: 20, length: 5 * HOUR, reset: now + 3 * HOUR };
  assert.deepEqual(quotaTiming(row, now), {
    stale: false, resetIn: 3 * HOUR, evenLeft: 60, runsOutIn: HOUR / 2,
  });
  assert.equal(quotaTiming({ ...row, left: 55 }, now).runsOutIn, null);
  assert.equal(quotaTiming({ ...row, left: 0 }, now).runsOutIn, null);
  assert.equal(quotaTiming({ ...row, reset: now + 4.75 * HOUR }, now).runsOutIn, null);
  assert.equal(quotaTiming({ ...row, length: null }, now).evenLeft, undefined);
  assert.equal(quotaTiming({ ...row, reset: now }, now).evenLeft, undefined);
  assert.equal(quotaTiming({ ...row, observedAt: now - HOUR, maxAge: HOUR / 2 }, now).stale, true);
  assert.equal(quotaTiming(row, now, true).evenLeft, undefined);
  assert.equal(duration(3.5 * HOUR), "3h 30m");
  assert.equal(duration(HOUR / 2 + 1), "30m");
});
