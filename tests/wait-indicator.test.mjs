import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../wait-indicator.ts", import.meta.url), "utf8");
const { latestWaitingGoal, renderGoalWait, GoalWaitIndicator } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const entry = (goal) => ({ type: "custom", customType: "goal-state", data: { goal } });
const waiting = { id: "goal-a", status: "active", waiting: { reason: "Esperar\n executor #20" } };
const truncate = (text, width) => text.slice(0, width);
const theme = { fg: (color, value) => `<${color}>${value}</${color}>` };

test("only the latest canonical state on this branch can show waiting", () => {
  assert.equal(latestWaitingGoal([entry(waiting)]).reason, "Esperar executor #20");
  for (const goal of [null, { ...waiting, status: "paused" }, { ...waiting, status: "complete" }, { ...waiting, waiting: undefined }]) {
    assert.equal(latestWaitingGoal([entry(waiting), entry(goal)]), undefined);
  }
});

test("hourglass animates and retains reason and wait time at bounded width", () => {
  const wait = latestWaitingGoal([entry(waiting)]);
  assert.notDeepEqual(renderGoalWait(wait, 0, 140, theme, truncate), renderGoalWait(wait, 500, 140, theme, truncate));
  assert.match(renderGoalWait(wait, 62000, 140, theme, truncate)[0], /aguardando · 1m 2s · Esperar executor #20/);
  assert.ok(renderGoalWait(wait, 0, 12, theme, truncate)[0].length <= 12);
});

test("animation reads branch only on state changes and stops on pause, switch and shutdown", () => {
  let entries = [entry(waiting)], leaf = "a", session = "one", now = 0, tick, reads = 0, renders = 0, cancels = 0;
  const widgets = [];
  const ctx = { hasUI: true, sessionManager: { getSessionId: () => session, getLeafId: () => leaf, getBranch: () => { reads++; return entries; } }, ui: { setWidget: (_key, factory) => { widgets.push(factory); if (factory) factory({ requestRender: () => renders++ }, theme); } } };
  const indicator = new GoalWaitIndicator(truncate, () => now, callback => { tick = callback; return { unref() {} }; }, () => cancels++);
  indicator.refresh(ctx);
  assert.equal(reads, 1);
  now = 500; tick(); tick();
  assert.equal(reads, 1, "UI ticks never query agents or repeatedly read the transcript");
  assert.ok(renders >= 3);
  entries = [entry(waiting), entry({ ...waiting, status: "paused" })]; leaf = "b"; tick();
  assert.equal(widgets.at(-1), undefined); assert.equal(cancels, 1);
  entries = [entry(waiting)]; indicator.refresh(ctx);
  session = "two"; entries = []; indicator.refresh(ctx);
  assert.equal(widgets.at(-1), undefined); assert.equal(indicator.timer, undefined);
  entries = [entry(waiting)]; indicator.refresh(ctx); indicator.dispose();
  assert.equal(indicator.context, undefined); assert.equal(indicator.timer, undefined);
});

test("headless contexts never start an animation", () => {
  const indicator = new GoalWaitIndicator(truncate, Date.now, () => { throw new Error("unexpected timer"); });
  indicator.refresh({ hasUI: false });
  assert.equal(indicator.timer, undefined);
});
