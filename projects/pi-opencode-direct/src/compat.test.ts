// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import opencodeDirectExtension from "./index.js";

// Regression tests pinning Zen request invariants against pi-cache-optimizer's
// actual payload transforms (see plans/cache-optimizer-compat-report.md §2):
//   T1: delete payload.prompt_cache_retention (unless official OpenAI / opt-in)
//   T2: { ...payload, prompt_cache_key: <hash> }  (spread, additive)
//   (Anthropic cache_control ops are gated on anthropic-messages api — N/A.)

async function getShim() {
  let registeredConfig: any = null;
  const fakePi = {
    registerProvider(id: any, config?: any) { if (id === "opencode-direct") registeredConfig = config; },
    on() {},
  } as unknown as ExtensionAPI;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ data: [] }) })) as unknown as typeof fetch;
  try { await opencodeDirectExtension(fakePi); } finally { globalThis.fetch = originalFetch; }
  return registeredConfig;
}

// Verbatim mirrors of cache-optimizer's operations (index.ts of the extension).
function stripPromptCacheRetention(payload: Record<string, unknown>): void {
  // Gate 4 safe default applies to Zen (not official OpenAI, no opt-in).
  delete payload.prompt_cache_retention;
}
function addOpenAIPromptCacheKey(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  if (typeof payload.prompt_cache_key === "string" && payload.prompt_cache_key.trim()) return payload;
  return { ...payload, prompt_cache_key: key };
}

test("T1: stripping prompt_cache_retention preserves all Zen-required fields", async () => {
  const payload: Record<string, unknown> = {
    model: "hy3-free",
    max_tokens: 4096,
    prompt_cache_retention: "long",
    messages: [
      {
        role: "assistant",
        reasoning_content: "<think>ok</think>",
        content: "",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "read", arguments: "{}" } }],
      },
    ],
  };
  stripPromptCacheRetention(payload);
  assert.equal("prompt_cache_retention" in payload, false);
  assert.equal(payload.max_tokens, 4096);                       // never renamed to max_completion_tokens
  assert.equal((payload.messages as any)[0].reasoning_content, "<think>ok</think>");
  assert.equal((payload.messages as any)[0].tool_calls.length, 1);
});

test("T2: prompt_cache_key injection is spread-additive and drops nothing", async () => {
  const before = {
    model: "qwen3-coder-free",
    max_tokens: 1024,
    stream: true,
    messages: [{ role: "assistant", reasoning_content: "<think>x</think>", content: "" }],
  };
  const after = addOpenAIPromptCacheKey(before, "abc123hash");
  for (const k of Object.keys(before)) assert.deepEqual(after[k], (before as any)[k]);
  assert.equal(after.prompt_cache_key, "abc123hash");
  assert.equal(after.max_tokens, 1024);
});

test("max_tokens is never renamed by any transform", async () => {
  const p: any = addOpenAIPromptCacheKey({ max_tokens: 512 }, "k");
  stripPromptCacheRetention(p);
  assert.equal(p.max_tokens, 512);
  assert.equal("max_completion_tokens" in p, false);
});

test("real native transport preserves Pi tools, public auth and OpenCode request headers", async () => {
  const cfg = await getShim();
  let request: any;
  const model: any = {
    id: "big-pickle", name: "Big Pickle", provider: "opencode-direct", api: "openai-completions",
    baseUrl: cfg.baseUrl, reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 16384,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { maxTokensField: "max_tokens" },
  };
  const stream = cfg.streamSimple(model, {
    messages: [{ role: "user", content: "Say OK", timestamp: Date.now() }],
    tools: [{ name: "read", description: "Real Pi read tool", parameters: { type: "object", properties: {} } }],
  }, {
    maxTokens: 20, sessionId: "stable-fixture-session", headers: { Authorization: "Bearer wrong" },
    onPayload: (payload: any) => addOpenAIPromptCacheKey(payload, "cache-key"),
    fetch: async (url: any, init: any) => {
      request = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) };
      return new Response(
        'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"big-pickle","choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}\n\n' +
        'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"big-pickle","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
        'data: [DONE]\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  const final = await stream.result();
  assert.equal(final.stopReason, "stop", final.errorMessage);
  assert.equal(request.url, "https://opencode.ai/zen/v1/chat/completions");
  assert.equal(request.headers.get("Authorization"), "Bearer public");
  assert.match(request.headers.get("x-opencode-session"), /^ses_[a-f0-9]{26}$/);
  assert.equal(request.body.prompt_cache_key, "cache-key");
  assert.equal(request.body.tools.find((t: any) => t.function.name === "read").function.description, "Real Pi read tool");
  assert.ok(request.body.tools.some((t: any) => t.function.name === "task"));
});
