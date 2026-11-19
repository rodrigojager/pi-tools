// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Live OpenCode Zen and Go model discovery.
 *
 * IDs come from each provider's REST models endpoint. Display
 * names, reasoning support, and limits come from the models.dev catalog;
 * anything unknown defaults to non-reasoning with conservative limits.
 * A failed endpoint returns null; an authoritative empty list returns [].
 * models.dev enriches live IDs and identifies retired/deprecated promotions.
 */
const ZEN_MODELS_URL = "https://opencode.ai/zen/v1/models";
const GO_MODELS_URL = "https://opencode.ai/zen/go/v1/models";
const MODELS_DEV_URL = "https://models.dev/api.json";
const FREE_REGEX = /(^(opencode\/)?.*-free$)|(^(opencode\/)?big-pickle$)/i;
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
function baseModelId(id) {
    return id.startsWith("opencode/") ? id.slice("opencode/".length).replace(/-free$/, "") : id.replace(/-free$/, "");
}
function humanizeName(id) {
    const base = id.replace(/-free$/, "").replace(/[_-]+/g, " ");
    return base
        .split(" ")
        .map(word => (word.charAt(0).toUpperCase() + word.slice(1)))
        .join(" ") + " (Free)";
}
/**
 * Builds pi's `thinkingLevelMap` from `reasoning_options`. Models without
 * explicit effort values get no map, deferring to the provider default.
 */
function buildThinkingLevelMap(meta) {
    if (!meta?.reasoning)
        return undefined;
    const options = meta.reasoning_options ?? [];
    const effort = options.find(o => o.type === "effort")?.values ?? [];
    const hasToggle = options.some(o => o.type === "toggle");
    if (effort.length === 0)
        return undefined;
    const map = {};
    for (const level of THINKING_LEVELS)
        map[level] = null;
    let sawNone = false;
    for (const value of effort) {
        if (value === "none") {
            map.off = "off";
            sawNone = true;
            continue;
        }
        if (value in map)
            map[value] = value;
    }
    if (hasToggle && !sawNone)
        map.off = "off";
    return map;
}
export function catalogModels(models, opts) {
    const provider = opts?.provider ?? "opencode";
    const seen = new Set();
    return models
        .filter((m) => typeof m?.id === "string" && m.id.length > 0 && (m.name === undefined || typeof m.name === "string"))
        .filter(m => !opts?.freeOnly || FREE_REGEX.test(m.id))
        .filter(m => { if (seen.has(m.id))
        return false; seen.add(m.id); return true; })
        .map((m) => {
        const bare = m.id.replace(/^(opencode|opencode-go)\//, "");
        const base = baseModelId(bare);
        const meta = opts?.catalog?.[bare] ?? opts?.catalog?.[base];
        const npm = meta?.provider?.npm;
        const free = FREE_REGEX.test(m.id);
        return {
            id: `${provider}/${bare}`,
            name: m.name ?? meta?.name ?? (free ? humanizeName(bare) : bare),
            reasoning: meta?.reasoning ?? false,
            contextWindow: validLimit(meta?.limit?.context, 128_000),
            maxTokens: validLimit(meta?.limit?.output, 16_384),
            thinkingLevelMap: buildThinkingLevelMap(meta),
            input: meta?.input,
            api: npm === "@ai-sdk/openai" ? "openai-responses"
                : npm === "@ai-sdk/anthropic" ? "anthropic-messages"
                    : npm === "@ai-sdk/google" ? "google-generative-ai" : undefined,
            cost: meta?.cost ? {
                input: validCost(meta.cost.input), output: validCost(meta.cost.output),
                cacheRead: validCost(meta.cost.cache_read), cacheWrite: validCost(meta.cost.cache_write),
            } : undefined,
            status: meta?.status,
            metadataKnown: meta !== undefined,
        };
    }).filter(m => m.status !== "deprecated");
}
function validLimit(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
function validCost(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
export function filterFreeModels(models, opts) {
    return catalogModels(models, { ...opts, freeOnly: true });
}
/** Metadata for both providers; a failure leaves live ID discovery usable. */
async function fetchModelsDevCatalog(fetcher, signal) {
    try {
        const res = await fetcher(MODELS_DEV_URL, { signal });
        if (!res.ok)
            return {};
        const cat = await res.json();
        const catalogs = {};
        for (const provider of ["opencode", "opencode-go"]) {
            const entries = cat?.[provider]?.models;
            if (!entries || typeof entries !== "object" || Array.isArray(entries))
                continue;
            const catalog = {};
            for (const [id, raw] of Object.entries(entries)) {
                if (!raw || typeof raw !== "object" || Array.isArray(raw))
                    continue;
                const m = raw;
                catalog[id] = {
                    name: typeof m.name === "string" ? m.name : undefined,
                    reasoning: m.reasoning === true,
                    reasoning_options: Array.isArray(m.reasoning_options) ? m.reasoning_options
                        .filter(o => o && typeof o.type === "string")
                        .map(o => ({ type: o.type, values: Array.isArray(o.values) ? o.values.filter(v => typeof v === "string") : undefined })) : undefined,
                    limit: m.limit,
                    input: Array.isArray(m.modalities?.input) ? m.modalities.input.filter(v => typeof v === "string") : undefined,
                    provider: m.provider,
                    cost: m.cost,
                    status: typeof m.status === "string" ? m.status : undefined,
                };
            }
            catalogs[provider] = catalog;
        }
        return catalogs;
    }
    catch {
        return {};
    }
}
export async function discoverCatalogs(opts) {
    const fetcher = opts?.fetchFn ?? fetch;
    // Strict boot budget: return nothing rather than block extension load if
    // neither source answers in time.
    const timeoutMs = opts?.timeoutMs ?? 5000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = opts?.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;
    try {
        // Combine the caller-provided signal (e.g. refreshModels cancellation)
        // with our own deadline so either one aborts discovery.
        if (signal.aborted)
            return { zen: null, go: null };
        const fetchList = async (url) => {
            try {
                const res = await fetcher(url, {
                    headers: { "User-Agent": "pi-opencode-direct/0.1.0", accept: "application/json" },
                    signal,
                });
                if (!res.ok)
                    return null;
                const data = await res.json();
                if (!data || typeof data !== "object" || !("data" in data) || !Array.isArray(data.data))
                    return null;
                // A nonempty, wholly malformed response is a failure, not an empty catalog.
                if (data.data.some(m => !m || typeof m.id !== "string" || !m.id.trim()))
                    return null;
                return data.data;
            }
            catch {
                return null;
            }
        };
        const [zen, go, catalog] = await Promise.all([
            fetchList(ZEN_MODELS_URL), fetchList(GO_MODELS_URL),
            fetchModelsDevCatalog(fetcher, signal),
        ]);
        if (signal.aborted && opts?.signal?.aborted)
            return { zen: null, go: null };
        const checkedAt = Date.now();
        return {
            zen: zen === null ? null : { models: catalogModels(zen, { catalog: catalog.opencode }), checkedAt },
            go: go === null ? null : { models: catalogModels(go, { catalog: catalog["opencode-go"], provider: "opencode-go" }), checkedAt },
        };
    }
    catch {
        return { zen: null, go: null };
    }
    finally {
        clearTimeout(timer);
    }
}
export async function discoverModels(opts) {
    const catalogs = await discoverCatalogs(opts);
    return catalogs.zen?.models.filter(m => FREE_REGEX.test(m.id)) ?? [];
}
export const CATALOG_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
/** One shared request batch for the three providers. No failed request becomes a fresh catalog. */
export function createCatalogDiscovery(opts) {
    let pending;
    let lastAttempt = 0;
    let current = { zen: null, go: null };
    return {
        current: () => current,
        refresh(force = false, signal) {
            if (process.env.PI_OFFLINE !== undefined || signal?.aborted)
                return Promise.resolve(current);
            if (pending)
                return pending;
            if (!force && lastAttempt && Date.now() - lastAttempt < CATALOG_REFRESH_INTERVAL_MS)
                return Promise.resolve(current);
            lastAttempt = Date.now();
            pending = discoverCatalogs({ ...opts, signal: signal ?? opts?.signal }).then(result => {
                current = result;
                return result;
            }).finally(() => { pending = undefined; });
            return pending;
        },
    };
}
//# sourceMappingURL=discovery.js.map