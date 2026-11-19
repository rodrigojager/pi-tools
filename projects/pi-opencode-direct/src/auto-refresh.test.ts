// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installAutoRefresh, OPENCODE_CATALOG_PROVIDERS } from "./auto-refresh.js";
import { CATALOG_REFRESH_INTERVAL_MS } from "./discovery.js";

test("startup and periodic refresh require no command, coalesce, and stop on shutdown", async () => {
  const originalInterval = globalThis.setInterval, originalClear = globalThis.clearInterval, originalNow = Date.now;
  const handlers = new Map<string, any>();
  let tick: (() => void) | undefined, cleared = 0, unref = 0, now = 100000;
  let calls = 0, lastOptions: any, release: (() => void) | undefined;
  globalThis.setInterval = ((fn: () => void, ms: number) => {
    assert.equal(ms, CATALOG_REFRESH_INTERVAL_MS); tick = fn;
    return { unref() { unref++; } };
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = (() => { cleared++; }) as typeof clearInterval;
  Date.now = () => now;
  try {
    installAutoRefresh({ on(event: string, handler: any) { handlers.set(event, handler); } } as unknown as ExtensionAPI);
    const ctx = { hasUI: false, modelRegistry: { refresh(options: any) {
      calls++; lastOptions = options;
      return new Promise<any>(resolve => { release = () => resolve({ errors: new Map() }); });
    } } };
    const start = handlers.get("session_start")({}, ctx);
    assert.equal(calls, 1);
    assert.deepEqual(lastOptions.providers, OPENCODE_CATALOG_PROVIDERS);
    assert.equal(lastOptions.allowNetwork, true);
    release!(); await start;
    assert.equal(unref, 1, "timer must not keep a headless child process alive");
    await handlers.get("before_agent_start")({}, ctx);
    assert.equal(calls, 1, "fresh catalogs do not get fetched every prompt");
    now += CATALOG_REFRESH_INTERVAL_MS;
    tick!();
    const prompt = handlers.get("before_agent_start")({}, ctx);
    assert.equal(calls, 2, "background refresh and prompt share the pending refresh");
    release!(); await prompt;
    handlers.get("session_shutdown")();
    assert.equal(cleared, 1);
    assert.equal(lastOptions.signal.aborted, true);
    now += CATALOG_REFRESH_INTERVAL_MS; tick!();
    assert.equal(calls, 2, "a cleared session cannot fetch again");
  } finally { globalThis.setInterval = originalInterval; globalThis.clearInterval = originalClear; Date.now = originalNow; }
});

test("a shutdown during startup cannot leave an orphaned refresh timer", async () => {
  const original = globalThis.setInterval;
  let intervals = 0, release: (() => void) | undefined;
  globalThis.setInterval = (() => { intervals++; return 1; }) as unknown as typeof setInterval;
  try {
    const handlers = new Map<string, any>();
    installAutoRefresh({ on(event: string, handler: any) { handlers.set(event, handler); } } as unknown as ExtensionAPI);
    const ctx = { hasUI: false, modelRegistry: { refresh() {
      return new Promise<any>(resolve => { release = () => resolve({ errors: new Map() }); });
    } } };
    const start = handlers.get("session_start")({}, ctx);
    handlers.get("session_shutdown")();
    release!(); await start;
    assert.equal(intervals, 0);
  } finally { globalThis.setInterval = original; }
});

test("PI_OFFLINE disables automatic network refresh and timers", async () => {
  const original = process.env.PI_OFFLINE;
  process.env.PI_OFFLINE = "1";
  try {
    const handlers = new Map<string, any>();
    installAutoRefresh({ on(event: string, handler: any) { handlers.set(event, handler); } } as unknown as ExtensionAPI);
    const ctx = { hasUI: false, modelRegistry: { refresh() { throw new Error("Must not fetch"); } } };
    await handlers.get("session_start")({}, ctx);
    await handlers.get("before_agent_start")({}, ctx);
    handlers.get("session_shutdown")();
  } finally { if (original === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = original; }
});
