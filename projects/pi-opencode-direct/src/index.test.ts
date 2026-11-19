// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import opencodeDirectExtension from "./index.js";

function fakePi() {
  const providers = new Map<string, any>();
  const handlers = new Map<string, any>();
  const pi = {
    registerProvider(id: any, config?: any) { providers.set(typeof id === "string" ? id : id.id, config ?? id); },
    on(event: string, handler: any) { handlers.set(event, handler); },
  } as unknown as ExtensionAPI;
  return { pi, providers, handlers };
}

const metadata = {
  opencode: { models: {
    "future-responses-free": { reasoning: true, provider: { npm: "@ai-sdk/openai" }, limit: { context: 256000, output: 8192 } },
    "claude-future": { provider: { npm: "@ai-sdk/anthropic" } },
  } },
  "opencode-go": { models: {
    "deepseek-v4.1-flash": { reasoning: true, limit: { context: 1000000, output: 384000 }, cost: { input: 0.15, output: 0.6 } },
    "go-responses": { provider: { npm: "@ai-sdk/openai" } },
  } },
};

function routes(zen = ["big-pickle", "future-responses-free", "claude-future"], go = ["deepseek-v4.1-flash", "go-responses"]) {
  return (async (url: any) => ({ ok: true, json: async () =>
    String(url).includes("models.dev") ? metadata
      : { data: (String(url).includes("/go/") ? go : zen).map(id => ({ id })) },
  })) as typeof fetch;
}

function context(extra: Record<string, unknown> = {}) {
  const persisted: any[] = [];
  return {
    ctx: {
      allowNetwork: true, signal: new AbortController().signal,
      publish: async (p: any) => { if (p.persist) persisted.push(p.persist); p.update?.(); return true; },
      ...extra,
    }, persisted,
  };
}

test("startup discovers all three catalogs before registration and keeps Go routing separate", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = routes();
  try {
    const f = fakePi();
    await opencodeDirectExtension(f.pi);
    assert.deepEqual([...f.providers.keys()].sort(), ["opencode", "opencode-direct", "opencode-go"]);
    assert.deepEqual(f.providers.get("opencode-direct").models.map((m: any) => m.id), ["big-pickle", "future-responses-free"]);
    const go = f.providers.get("opencode-go").getModels();
    assert.equal(go[0].id, "deepseek-v4.1-flash");
    assert.equal(go[0].baseUrl, "https://opencode.ai/zen/go/v1");
    assert.equal(go[0].contextWindow, 1000000);
    assert.equal(go[0].cost.input, 0.15);
    assert.equal(go[1].api, "openai-responses");
    assert.equal(f.providers.get("opencode").getModels().find((m: any) => m.id === "claude-future").api, "anthropic-messages");
    assert.ok(f.handlers.has("session_start"));
    assert.ok(f.handlers.has("session_shutdown"));
    assert.ok(f.handlers.has("before_agent_start"));
  } finally { globalThis.fetch = originalFetch; }
});

test("successful refresh replaces removed IDs, persists exact catalogs, and shares network work", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = routes();
  try {
    const f = fakePi(); await opencodeDirectExtension(f.pi);
    let requests = 0;
    const fixture = routes(["new-free"], ["new-go"]);
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => { requests++; return fixture(...args); }) as typeof fetch;
    const c = context({ force: true });
    await Promise.all([...f.providers.values()].map(p => p.refreshModels(c.ctx)));
    assert.equal(requests, 3, "one Zen, one Go and one metadata request");
    assert.deepEqual(f.providers.get("opencode").getModels().map((m: any) => m.id), ["new-free"]);
    assert.deepEqual(f.providers.get("opencode-go").getModels().map((m: any) => m.id), ["new-go"]);
    assert.equal(c.persisted.length, 3);
    assert.ok(c.persisted.every(p => p.checkedAt > 0));
  } finally { globalThis.fetch = originalFetch; }
});

test("offline startup has no invented free IDs and restores the last stored snapshot", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("Offline"); }) as typeof fetch;
  try {
    const f = fakePi(); await opencodeDirectExtension(f.pi);
    const direct = f.providers.get("opencode-direct");
    assert.deepEqual(direct.models, []);
    const { ctx } = context({ allowNetwork: false, stored: { models: [{
      id: "future-responses-free", name: "Future", provider: "opencode-direct", api: "openai-responses",
      baseUrl: "https://opencode.ai/zen/v1", reasoning: true, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256000, maxTokens: 8192,
    }] } });
    const restored = await direct.refreshModels(ctx);
    assert.equal(restored[0].id, "future-responses-free");
    assert.equal(restored[0].api, "openai-completions", "the direct wrapper must not be bypassed");
  } finally { globalThis.fetch = originalFetch; }
});

test("fresh startup catalog wins over obsolete cached IDs; failures keep the last good list", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = routes();
  try {
    const f = fakePi(); await opencodeDirectExtension(f.pi);
    const direct = f.providers.get("opencode-direct");
    const offline = context({ allowNetwork: false, stored: { models: [{ id: "removed-free", provider: "opencode-direct", api: "openai-completions" }] } });
    assert.equal((await direct.refreshModels(offline.ctx))[0].id, "big-pickle");
    globalThis.fetch = (async () => { throw new Error("Offline"); }) as typeof fetch;
    const c = context({ force: true });
    const results = await Promise.allSettled([...f.providers.values()].map(p => p.refreshModels(c.ctx)));
    assert.ok(results.every(r => r.status === "rejected"));
    assert.equal(c.persisted.length, 0, "failed requests must not stamp a fresh snapshot");
    assert.equal(f.providers.get("opencode-go").getModels()[0].id, "deepseek-v4.1-flash");
    assert.equal((await direct.refreshModels(offline.ctx))[0].id, "big-pickle");
  } finally { globalThis.fetch = originalFetch; }
});

test("authoritative empty catalogs remove the previous list instead of reviving a static fallback", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = routes();
  try {
    const f = fakePi(); await opencodeDirectExtension(f.pi);
    globalThis.fetch = routes([], []);
    const c = context({ force: true });
    const direct = f.providers.get("opencode-direct");
    assert.deepEqual(await direct.refreshModels(c.ctx), []);
    await f.providers.get("opencode-go").refreshModels(c.ctx);
    assert.deepEqual(f.providers.get("opencode-go").getModels(), []);
    assert.ok(c.persisted.every(p => p.models.length === 0));
  } finally { globalThis.fetch = originalFetch; }
});

test("cancelled refresh neither publishes nor changes the current catalog", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = routes();
  try {
    const f = fakePi(); await opencodeDirectExtension(f.pi);
    const controller = new AbortController(); controller.abort();
    let fetches = 0;
    globalThis.fetch = (async () => { fetches++; throw new Error("Must not fetch"); }) as typeof fetch;
    const c = context({ force: true, signal: controller.signal });
    await Promise.all([...f.providers.values()].map(p => p.refreshModels(c.ctx)));
    assert.equal(fetches, 0);
    assert.equal(c.persisted.length, 0);
    assert.equal(f.providers.get("opencode-go").getModels()[0].id, "deepseek-v4.1-flash");
  } finally { globalThis.fetch = originalFetch; }
});
