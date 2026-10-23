// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { withOpenCodeCatalog } from "./catalog-provider.js";
import { createCatalogDiscovery } from "./discovery.js";

for (const id of ["opencode", "opencode-go"]) {
  for (const api of ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"] as const) {
    test(`${id}/${api} sends the same conversation header through both native streaming paths`, async () => {
      const base = builtinProviders().find(provider => provider.id === id)!;
      const provider = withOpenCodeCatalog(base, id === "opencode" ? "zen" : "go", createCatalogDiscovery());
      const model = { ...(base.getModels().find(m => m.api === api) ?? base.getModels()[0]!), api };
      const context = { messages: [{ role: "user" as const, content: "Local header check", timestamp: Date.now() }] };
      const captures: Headers[] = [];
      const options = {
        apiKey: "fixture-key", maxTokens: 1, sessionId: "stable-pi-conversation",
        fetch: (async (_input: unknown, init?: RequestInit) => {
          captures.push(new Headers(init?.headers));
          throw new Error("LOCAL_CAPTURE_ONLY");
        }) as typeof fetch,
      };
      const originalFetch = globalThis.fetch;
      // Google's SDK accepts the process fetch rather than a custom transport.
      if (api === "google-generative-ai") globalThis.fetch = options.fetch;
      try {
        await provider.stream(model, context, options).result();
        await provider.streamSimple(model, context, options).result();
        assert.equal(captures.length, 2);
        for (const headers of captures) {
          assert.equal(headers.get("x-opencode-session"), "stable-pi-conversation");
          assert.equal(headers.get("user-agent"), "pi-opencode-direct/0.1.0");
          assert.ok(headers.get("authorization")?.includes("fixture-key") || headers.get("x-api-key") === "fixture-key" || headers.get("x-goog-api-key") === "fixture-key");
        }
        await provider.streamSimple(model, context, {
          ...options, sessionId: "next-conversation",
          headers: { "X-OpenCode-Session": "explicit-session", "user-agent": "custom-coding-agent/1.0" },
        }).result();
        assert.equal(captures[2]?.get("x-opencode-session"), "explicit-session");
        assert.equal(captures[2]?.get("user-agent"), "custom-coding-agent/1.0");
        await provider.streamSimple(model, context, { ...options, sessionId: "next-conversation" }).result();
        assert.equal(captures[3]?.get("x-opencode-session"), "next-conversation");
        assert.equal(options.sessionId, "stable-pi-conversation");
      } finally { globalThis.fetch = originalFetch; }
    });
  }
}
