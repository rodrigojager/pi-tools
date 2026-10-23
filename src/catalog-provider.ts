// SPDX-License-Identifier: GPL-3.0-or-later
import type { Api, Model, Provider, ProviderHeaders, StreamOptions } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import type { CatalogResult, OpenCodeCatalogs, OpenCodeModelInfo, createCatalogDiscovery } from "./discovery.js";

type Discovery = ReturnType<typeof createCatalogDiscovery>;

// Go accepts coding agents directly: identify Pi and retain the conversation
// ID across turns, even when the host resolves an older native provider.
function withCodingAgentHeaders<T extends StreamOptions>(options?: T) {
  const headers: ProviderHeaders = { ...options?.headers };
  const hasHeader = (name: string) => Object.keys(headers).some(key => key.toLowerCase() === name);
  const userAgent = Object.entries(headers).find(([key]) => key.toLowerCase() === "user-agent");
  for (const key of Object.keys(headers)) if (key.toLowerCase() === "user-agent") delete headers[key];
  headers["User-Agent"] = userAgent ? userAgent[1] : "pi-opencode-direct/0.1.0";
  if (options?.sessionId && !hasHeader("x-opencode-session")) {
    headers["x-opencode-session"] = options.sessionId;
  }
  return { ...options, headers } as T;
}

/** Refresh catalogs and session headers while retaining native auth and API engines. */
export function withOpenCodeCatalog(base: Provider, source: keyof OpenCodeCatalogs, discovery: Discovery): Provider & { getAllModels(): readonly Model<Api>[] } {
  const baseline = new Map(base.getModels().map(m => [m.id, m]));
  const baselineApis = new Set([...baseline.values()].map(m => m.api));
  // New catalog entries can use an API absent from an older provider factory
  // (for example Google on Go). Keep dispatch on Pi's native API engine.
  const transport = (api: Api) => baselineApis.has(api) ? base : getApiProvider(api) ?? base;
  const baseUrl = source === "go" ? "https://opencode.ai/zen/go/v1" : "https://opencode.ai/zen/v1";
  const convert = (m: OpenCodeModelInfo): Model<Api> => {
    const id = m.id.replace(/^(opencode|opencode-go)\//, "");
    const old = baseline.get(id);
    const api = m.api ?? old?.api ?? "openai-completions";
    return {
      ...old,
      id, name: m.name, provider: base.id, baseUrl, api,
      reasoning: m.metadataKnown ? m.reasoning : old?.reasoning ?? m.reasoning,
      thinkingLevelMap: m.metadataKnown ? m.thinkingLevelMap : old?.thinkingLevelMap,
      input: m.metadataKnown ? (m.input?.includes("image") ? ["text", "image"] : ["text"]) : old?.input ?? ["text"],
      contextWindow: m.metadataKnown ? m.contextWindow : old?.contextWindow ?? m.contextWindow,
      maxTokens: m.metadataKnown ? m.maxTokens : old?.maxTokens ?? m.maxTokens,
      cost: m.cost ?? old?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ...(api === "openai-completions" && { compat: {
        ...old?.compat, supportsStore: false, supportsDeveloperRole: false,
        supportsFinishReason: false, maxTokensField: "max_tokens",
        requiresReasoningContentOnAssistantMessages: true,
      } }),
    };
  };
  let latest: CatalogResult | null = discovery.current()[source];
  let models: readonly Model<Api>[] = latest ? latest.models.map(convert) : base.getModels();
  return {
    ...base,
    baseUrl,
    getModels: () => models,
    getAllModels: () => models,
    stream: (model, context, options) => transport(model.api).stream(model, context, withCodingAgentHeaders(options)),
    streamSimple: (model, context, options) => transport(model.api).streamSimple(model, context, withCodingAgentHeaders(options)),
    async refreshModels(ctx) {
      if (ctx.signal.aborted) return;
      const online = ctx.allowNetwork && process.env.PI_OFFLINE === undefined;
      const result = (online ? await discovery.refresh(ctx.force, ctx.signal) : discovery.current())[source];
      if (ctx.signal.aborted) return;
      if (result) {
        const next = result.models.map(convert);
        await ctx.publish({
          persist: { models: next, checkedAt: result.checkedAt },
          update: () => { models = next; latest = result; },
        });
      } else if (online) {
        // Throwing preserves the last valid list and lets Pi report a refresh failure.
        throw new Error(`Cannot refresh OpenCode ${source} catalog; keeping the last known models.`);
      } else if (!latest && ctx.stored) {
        const restored = ctx.stored.models.filter((m): m is Model<Api> =>
          m.provider === base.id && m.baseUrl === baseUrl);
        await ctx.publish({ update: () => { models = restored; } });
      }
    },
  };
}
