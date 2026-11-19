// SPDX-License-Identifier: GPL-3.0-or-later
import { randomUUID } from "node:crypto";
// pi's extension loader aliases the pi-ai root to the /compat entrypoint and
// only whitelists exact subpaths (/compat, /oauth, /providers/all), so deeper
// subpath imports like .../api/openai-completions fail to resolve at load time.
import { openAICompletionsApi, openAIResponsesApi } from "@earendil-works/pi-ai/compat";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { createCatalogDiscovery } from "./discovery.js";
import { withOpenCodeCatalog } from "./catalog-provider.js";
import { installAutoRefresh } from "./auto-refresh.js";
const nativeOpenAICompletionsStream = openAICompletionsApi().streamSimple;
const nativeOpenAIResponsesStream = openAIResponsesApi().streamSimple;
const PROVIDER_ID = "opencode-direct";
const BASE_URL = "https://opencode.ai/zen/v1";
const OPENCODE_NATIVE_TOOLS = [
    "bash", "edit", "glob", "grep", "read", "skill", "task", "todowrite", "webfetch", "websearch", "write",
];
function nativeId(prefix) {
    return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 26)}`;
}
/**
 * Zen currently recognizes the official client by both headers and the core
 * OpenCode tool declarations. Keep Pi's real tools and add harmless schemas
 * only for missing native names. Calls to names unavailable in Pi are rejected
 * by Pi's normal tool allowlist; no OpenCode process or native tool executes.
 */
function preserveNativeRequestShape(payload) {
    if (!payload || typeof payload !== "object")
        return payload;
    const body = payload;
    const tools = Array.isArray(body.tools) ? [...body.tools] : [];
    const names = new Set(tools.map((tool) => {
        if (!tool || typeof tool !== "object")
            return undefined;
        const value = tool;
        return typeof value.name === "string" ? value.name : typeof value.function?.name === "string" ? value.function.name : undefined;
    }).filter((name) => !!name));
    const responsesApi = "input" in body;
    for (const name of OPENCODE_NATIVE_TOOLS) {
        if (names.has(name))
            continue;
        const definition = { name, description: `OpenCode-compatible ${name} tool`, parameters: { type: "object", properties: {}, additionalProperties: true } };
        tools.push(responsesApi ? { type: "function", ...definition, strict: false } : { type: "function", function: definition });
    }
    return { ...body, tools, tool_choice: body.tool_choice ?? "auto" };
}
// Describes Zen's upstream quirks to Pi's native openai-completions engine
// (max_tokens field name, reasoning_content replay) — no custom streaming code.
const OPENCODE_COMPAT = {
    supportsStore: false,
    supportsDeveloperRole: false,
    // Zen often ends streams without finish_reason; let pi infer stop/toolUse
    // instead of throwing "Stream ended without finish_reason".
    supportsFinishReason: false,
    maxTokensField: "max_tokens",
    requiresReasoningContentOnAssistantMessages: true,
};
/** Maps a discovered model to the provider config shape. */
function toProviderModel(m) {
    return {
        id: m.id.replace(/^opencode\//, ""),
        name: m.status === "deprecated" ? `${m.name} [Deprecated]` : m.name,
        // Keep every model on the provider's registered API so Pi always enters
        // our streamSimple wrapper. Responses-only models are dispatched by ID
        // inside the wrapper; exposing openai-responses here would bypass the
        // provider wrapper and Pi would inject the placeholder credential.
        api: "openai-completions",
        reasoning: m.reasoning ?? false,
        thinkingLevelMap: m.thinkingLevelMap,
        input: (m.input?.includes("image") ? ["text", "image"] : ["text"]),
        contextWindow: m.contextWindow ?? 128_000,
        maxTokens: m.maxTokens ?? 16_384,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        compat: OPENCODE_COMPAT,
    };
}
function toStoredModel(config) {
    return { ...config, provider: PROVIDER_ID, baseUrl: BASE_URL };
}
function fromStoredModel(m) {
    const { provider: _provider, baseUrl: _baseUrl, ...config } = m;
    return config;
}
export default async function opencodeDirectExtension(pi) {
    const discovery = createCatalogDiscovery();
    // Resolve IDs before Pi's initial CLI model selection, not after a failed request.
    await discovery.refresh();
    const freeModels = () => discovery.current().zen?.models.filter(m => /-free$|\/big-pickle$/.test(m.id));
    let responseIds = new Set();
    const convert = (models) => {
        responseIds = new Set(models.filter(m => m.api === "openai-responses").map(m => m.id.replace(/^opencode\//, "")));
        return models.map(toProviderModel);
    };
    const initial = freeModels();
    let latestModels = initial ? convert(initial) : undefined;
    pi.registerProvider(PROVIDER_ID, {
        name: "OpenCode Direct HTTP (Free)",
        baseUrl: BASE_URL,
        // Placeholder for Pi's auth composition; the free-tier wrapper supplies
        // the public identifier on actual requests.
        apiKey: "none",
        api: "openai-completions",
        headers: {
            "x-opencode-client": "cli",
            "x-opencode-project": "global",
            "User-Agent": "opencode/1.18.31 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14",
            // Public Authorization is supplied per request in streamSimple.
        },
        models: latestModels ?? [],
        async refreshModels(ctx) {
            if (!ctx.allowNetwork || process.env.PI_OFFLINE !== undefined) {
                if (latestModels)
                    return latestModels;
                const stored = ctx.stored?.models
                    .filter(m => m.provider === PROVIDER_ID && (m.api === "openai-completions" || m.api === "openai-responses"))
                    .map(fromStoredModel) ?? [];
                responseIds = new Set(stored.filter(m => m.api === "openai-responses").map(m => m.id));
                latestModels = stored.map(m => ({ ...m, api: "openai-completions" }));
                return latestModels;
            }
            if (ctx.signal.aborted)
                return [];
            await discovery.refresh(ctx.force, ctx.signal);
            if (ctx.signal.aborted)
                return latestModels ?? [];
            const discovered = freeModels();
            if (!discovered)
                throw new Error("Cannot refresh OpenCode Zen free catalog; keeping the last known models.");
            const configs = discovered.map(toProviderModel);
            const persisted = configs.map((config, i) => ({
                ...toStoredModel(config), api: discovered[i]?.api === "openai-responses" ? "openai-responses" : config.api,
            }));
            const published = await ctx.publish({ persist: { models: persisted, checkedAt: discovery.current().zen.checkedAt } });
            if (published)
                latestModels = convert(discovered);
            return configs;
        },
        // Public free-tier shim over Pi's native engines, dispatched by upstream API.
        // Streaming, tools, reasoning, and cost handling stay fully native.
        streamSimple: (model, context, options) => {
            const responsesOnly = responseIds.has(model.id) || model.id.startsWith("muse-spark-");
            const native = responsesOnly
                ? nativeOpenAIResponsesStream
                : nativeOpenAICompletionsStream;
            const requestModel = responsesOnly ? { ...model, api: "openai-responses" } : model;
            const sessionId = nativeId("ses");
            return native(requestModel, context, {
                ...options,
                apiKey: "public",
                headers: {
                    ...options?.headers,
                    Authorization: "Bearer public",
                    "User-Agent": "opencode/1.18.31 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14",
                    "x-opencode-client": "cli",
                    "x-opencode-project": "global",
                    "x-opencode-session": sessionId,
                    "x-opencode-request": nativeId("msg"),
                },
                fetch: async (input, init) => {
                    const headers = new Headers(init?.headers);
                    headers.set("Authorization", "Bearer public");
                    headers.set("User-Agent", "opencode/1.18.31 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14");
                    headers.set("x-opencode-client", "cli");
                    headers.set("x-opencode-project", "global");
                    headers.set("x-opencode-session", sessionId);
                    headers.set("x-opencode-request", nativeId("msg"));
                    return (options?.fetch ?? globalThis.fetch)(input, { ...init, headers });
                },
                onPayload: async (payload, requestModel) => {
                    const transformed = await options?.onPayload?.(payload, requestModel);
                    return preserveNativeRequestShape(transformed ?? payload);
                },
            });
        },
    });
    for (const provider of builtinProviders()) {
        if (provider.id === "opencode" || provider.id === "opencode-go") {
            pi.registerProvider(withOpenCodeCatalog(provider, provider.id === "opencode-go" ? "go" : "zen", discovery));
        }
    }
    installAutoRefresh(pi);
}
//# sourceMappingURL=index.js.map