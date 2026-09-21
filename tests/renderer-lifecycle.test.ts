import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TuiAltScreen, TuiMainScreen } from "@earendil-works/pi-tui";
import { SidebarCompositor } from "../compositor.ts";
import type { SidebarContext } from "../types.ts";

// Reproduce Pi 0.86.1 createInteractiveTuiReference semantics: captured methods
// follow the active renderer after a mode switch, including Object.valueOf.
function createTuiReference(getTui: () => any): any {
  return new Proxy({}, {
    get(_target, property) {
      const tui = getTui();
      const value = Reflect.get(tui, property, tui);
      if (typeof value !== "function") return value;
      let methodTui = tui;
      let method = value;
      return (...args: any[]) => {
        const currentTui = getTui();
        if (currentTui !== methodTui) {
          const currentMethod = Reflect.get(currentTui, property, currentTui);
          if (typeof currentMethod !== "function") throw new TypeError("TUI method is not callable");
          methodTui = currentTui;
          method = currentMethod;
        }
        return Reflect.apply(method, methodTui, args);
      };
    },
    set(_target, property, value) {
      const tui = getTui();
      return Reflect.set(tui, property, value, tui);
    },
    has: (_target, property) => Reflect.has(getTui(), property),
    getPrototypeOf: () => Reflect.getPrototypeOf(getTui()),
  });
}

function makeTerminal(): any {
  return {
    columns: 160, rows: 40, writes: [] as string[],
    write(data: string) { this.writes.push(data); },
    hideCursor() {}, showCursor() {}, moveBy() {}, clearLine() {},
    clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {},
    start() {}, stop() {}, async drainInput() {},
  };
}

function makeContext(): SidebarContext {
  return {
    sessionTitle: null, sessionId: null, todos: [], todosMax: 10,
    branch: null, aheadCount: 0, untrackedCount: 0, workspaceFiles: [], cwd: "",
    model: null, thinkingLevel: null, contextTokens: null, contextPercent: null,
    contextWindow: null, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0,
    sessionCost: 0, turnCount: 0, activeTool: null, autoCompactEnabled: null,
    sessionStartMs: Date.now(), mcpServers: [], modelProvider: null,
    cavemanLevel: null, cavemanFrame: 0, agentActive: false, spinnerFrame: 0,
    liveTps: null, lastTps: null, lastTurnMs: null, ctxSamples: [],
  };
}

test("disposing a compositor after a mode switch restores only its original renderer", () => {
  const terminal = makeTerminal();
  let current: any = new TuiMainScreen(terminal, false);
  const proxy = createTuiReference(() => current);
  assert.equal(proxy.valueOf(), current);
  for (let cycle = 0; cycle < 20; cycle++) {
    const previous = current;
    const previousRender = previous.doRender;
    const comp = new SidebarCompositor(proxy, makeContext, 40);
    comp.install();
    assert.equal(terminal.columns, 119);
    comp.paint();
    previous.doRender();
    current = cycle % 2 === 0 ? new TuiAltScreen(terminal, false) : new TuiMainScreen(terminal, false);
    const nextRender = current.doRender;
    comp.dispose();
    // Original 1.7.4 throws RangeError here: it restores a proxy wrapper onto
    // the new renderer, and that wrapper resolves itself recursively.
    assert.doesNotThrow(() => current.doRender());
    assert.equal(current.doRender, nextRender);
    assert.equal(previous.doRender, previousRender);
    assert.equal(terminal.columns, 160);
    comp.dispose();
  }
});

test("repeated reloads preserve width, rendering, and synchronized sidebar painting", () => {
  const terminal = makeTerminal();
  const current: any = new TuiMainScreen(terminal, false);
  const proxy = createTuiReference(() => current);
  const render = current.doRender;
  for (let cycle = 0; cycle < 20; cycle++) {
    const comp = new SidebarCompositor(proxy, makeContext, 40);
    comp.install();
    comp.paint();
    current.doRender();
    comp.dispose();
    assert.equal(current.doRender, render);
    assert.equal(terminal.columns, 160);
  }
  assert(terminal.writes.some((data: string) => data.includes("Session")));
  assert(terminal.writes.some((data: string) => data.includes("\x1b[?2026h")));
  assert(terminal.writes.some((data: string) => data.includes("\x1b[?2026l")));
});

test("widget follows renderer changes and ignores obsolete widget disposal", async () => {
  const originalConfig = process.env.PI_SIDEBAR_CONFIG;
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  const agentDir = mkdtempSync(join(tmpdir(), "sidebar-renderer-"));
  process.env.PI_SIDEBAR_CONFIG = join(agentDir, "sidebar-tui.json");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const handlers = new Map<string, (...args: any[]) => any>();
  let widget: any;
  try {
    const { default: registerSidebar } = await import("../index.ts");
    let factory: any;
    registerSidebar({
      on(name: string, fn: (...args: any[]) => any) { handlers.set(name, fn); },
      registerCommand() {}, registerShortcut() {},
    } as any);
    const ctx = {
      hasUI: true, cwd: agentDir,
      sessionManager: { getSessionName() {}, getBranch() { return []; }, getSessionId() { return "test"; } },
      ui: { setWidget(_name: string, fn: any) { factory = fn; } },
    };
    await handlers.get("session_start")!({}, ctx);
    const terminal = makeTerminal();
    let current: any = new TuiMainScreen(terminal, false);
    const proxy = createTuiReference(() => current);
    widget = factory(proxy, null);
    const columns = terminal.columns;
    assert(columns < 160);
    for (let cycle = 0; cycle < 20; cycle++) {
      current = cycle % 2 === 0 ? new TuiAltScreen(terminal, false) : new TuiMainScreen(terminal, false);
      const originalRender = current.doRender;
      widget.render(columns);
      assert.notEqual(current.doRender, originalRender);
      assert.equal(terminal.columns, columns);
      assert.doesNotThrow(() => current.doRender());
      const previousWidget = widget;
      widget = factory(proxy, null);
      previousWidget.dispose();
      assert.equal(terminal.columns, columns);
      assert.doesNotThrow(() => current.doRender());
    }
    widget.dispose();
    assert.equal(terminal.columns, 160);
  } finally {
    widget?.dispose();
    await handlers.get("session_shutdown")?.();
    if (originalConfig === undefined) delete process.env.PI_SIDEBAR_CONFIG;
    else process.env.PI_SIDEBAR_CONFIG = originalConfig;
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  }
});
