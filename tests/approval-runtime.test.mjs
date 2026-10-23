import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const hostRoot = process.env.PI_CODING_AGENT_DIR ?? join(process.env.APPDATA, "npm/node_modules/@earendil-works/pi-coding-agent");
const hostImport = (path) => import(pathToFileURL(join(hostRoot, "dist", path)).href);
const { loadExtensions, loadExtensionFromFactory } = await hostImport("core/extensions/loader.js");
const { ExtensionRunner } = await hostImport("core/extensions/runner.js");
const { wrapRegisteredTool } = await hostImport("core/extensions/wrapper.js");
const { SessionManager } = await hostImport("core/session-manager.js");
const { createEventBus } = await hostImport("core/event-bus.js");
const cwd = fileURLToPath(new URL("..", import.meta.url));
const extensionPath = fileURLToPath(new URL("../../../extensions/goal-auto-approve.ts", import.meta.url));

async function harness() {
  const loaded = await loadExtensions([extensionPath], cwd);
  assert.deepEqual(loaded.errors, [], "the installed Pi loader must load the autoload entry");
  const prompts = [];
  const uiEvents = [];
  const errors = [];
  const session = SessionManager.inMemory(cwd);
  const fixture = await loadExtensionFromFactory((pi) => {
    pi.on("ui_prompt_start", (event) => uiEvents.push(event));
    pi.registerTool({
      name: "confirmation_fixture", label: "Confirm", description: "Exercise the same UI API as project agents",
      parameters: { type: "object", properties: {} },
      execute: async (_id, params, _signal, _update, ctx) => ({
        content: [{ type: "text", text: String(await ctx.ui.confirm(params.title, params.message, params.options)) }],
      }),
    });
  }, cwd, createEventBus(), loaded.runtime);
  const runner = new ExtensionRunner([...loaded.extensions, fixture], loaded.runtime, cwd, session, {});
  runner.onError((error) => errors.push(error));
  const hostUI = {
    confirm: async function (...args) {
      assert.equal(this, hostUI, "the original confirmation must retain its receiver");
      prompts.push(args);
      return false;
    },
    input: async () => "information",
    select: async () => "choice",
    notify: () => {},
  };
  runner.setUIContext(hostUI, "interactive");
  await runner.emit({ type: "session_start" });
  const tool = wrapRegisteredTool(runner.getAllRegisteredTools().find((tool) => tool.definition.name === "confirmation_fixture"), runner);
  return {
    runner, session, prompts, uiEvents, errors,
    state: (status) => session.appendCustomEntry("goal-state", { goal: status === null ? null : { id: "test-goal", status } }),
    confirm: async (title = "Run project-local agent?", message = "Agent: test\nSource: .pi/agents", options) => {
      const result = await tool.execute("test-call", { title, message, options });
      assert.deepEqual(errors, []);
      return result.content[0].text;
    },
    beforeStart: () => runner.emitBeforeAgentStart("continue", undefined, { cwd, selectedTools: [], skills: [], contextFiles: [] }),
  };
}

test("all confirmation types auto-approve from a separate tool context while a goal is active", async () => {
  const h = await harness();
  h.state("active");
  for (const title of ["Run project-local agent?", "Run global agent?", "Execute command?", "Overwrite file?", "Publish changes?", "Unknown future confirmation"]) {
    assert.equal(await h.confirm(title), "true");
  }
  assert.equal(h.prompts.length, 0);
  assert.equal(h.uiEvents.length, 0, "automatic approval must not suspend goal continuation for a UI prompt");
  const prompt = await h.beforeStart();
  assert.match(prompt.systemPromptOptions.sections.goal_approvals, /without asking for permission/);
});

for (const status of ["paused", "blocked", "complete", "usage_limited", "budget_limited", null]) {
  test(`latest ${status ?? "cleared"} goal stops approvals immediately`, async () => {
    const h = await harness();
    h.state("active");
    assert.equal(await h.confirm(), "true");
    h.state(status);
    const options = { timeout: 1000 };
    assert.equal(await h.confirm("Action?", "Message", options), "false");
    assert.deepEqual(h.prompts, [["Action?", "Message", options]]);
    assert.equal(h.uiEvents.length, 1);
    assert.equal((await h.beforeStart()).systemPromptOptions.sections.goal_approvals, undefined);
    h.state("active");
    assert.equal(await h.confirm(), "true", "resume must reactivate approvals without reloading");
    assert.equal(h.prompts.length, 1);
  });
}

test("an active goal on a sibling branch does not authorize this branch", async () => {
  const h = await harness();
  const pausedLeaf = h.state("paused");
  h.state("active");
  assert.equal(await h.confirm(), "true");
  h.session.branch(pausedLeaf);
  assert.equal(await h.confirm(), "false");
  assert.equal(h.prompts.length, 1);
});

test("no goal and malformed latest state retain the original UI", async () => {
  const h = await harness();
  assert.equal(await h.confirm(), "false");
  h.state("active");
  h.session.appendCustomEntry("goal-state", { goal: { status: "active" } });
  assert.equal(await h.confirm(), "false");
  h.session.appendCustomEntry("goal-state", null);
  assert.equal(await h.confirm(), "false");
});

test("information input and selectors remain available during a goal", async () => {
  const h = await harness();
  h.state("active");
  const ui = h.runner.createContext().ui;
  assert.equal(await ui.input("Missing information"), "information");
  assert.equal(await ui.select("Choose a value", ["choice"]), "choice");
});

test("UI replacement and shutdown do not retain a stale wrapper", async () => {
  const h = await harness();
  h.state("active");
  h.runner.setUIContext({ confirm: async () => false, notify: () => {} }, "interactive");
  await h.beforeStart();
  assert.equal(await h.confirm(), "true");
  const ui = h.runner.createContext().ui;
  await h.runner.emit({ type: "session_shutdown", reason: "reload" });
  h.runner.invalidate();
  assert.equal(await ui.confirm("Action?", "Message"), false, "shutdown must restore the original UI before contexts are invalidated");
  assert.deepEqual(h.errors, []);
});

test("headless mode still adds autonomy instructions without changing the no-UI context", async () => {
  const h = await harness();
  h.runner.setUIContext(undefined, "print");
  h.state("active");
  const result = await h.beforeStart();
  assert.match(result.systemPromptOptions.sections.goal_approvals, /automatically|automatic/);
  assert.equal(await h.runner.createContext().ui.confirm("Action?", "Message"), false);
});
