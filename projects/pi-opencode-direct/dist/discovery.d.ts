/**
 * Live OpenCode Zen and Go model discovery.
 *
 * IDs come from each provider's REST models endpoint. Display
 * names, reasoning support, and limits come from the models.dev catalog;
 * anything unknown defaults to non-reasoning with conservative limits.
 * A failed endpoint returns null; an authoritative empty list returns [].
 * models.dev enriches live IDs and identifies retired/deprecated promotions.
 */
export interface OpenCodeModelInfo {
    id: string;
    name: string;
    reasoning: boolean;
    contextWindow: number;
    maxTokens: number;
    /** pi thinking level → provider value. `null` marks the level unsupported. */
    thinkingLevelMap?: Record<string, string | null>;
    /** Input modalities advertised by models.dev (subset relevant to pi). */
    input?: string[];
    /** Set when models.dev routes the model via @ai-sdk/openai (Responses API);
     * absent means the zen default chat/completions path. */
    api?: "openai-responses" | "openai-completions" | "anthropic-messages" | "google-generative-ai";
    cost?: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
    };
    status?: string;
    metadataKnown?: boolean;
}
interface ModelMeta {
    name?: string;
    reasoning?: boolean;
    reasoning_options?: Array<{
        type: string;
        values?: string[];
    }>;
    limit?: {
        context?: number;
        output?: number;
    };
    input?: string[];
    provider?: {
        npm?: string;
    };
    cost?: {
        input?: number;
        output?: number;
        cache_read?: number;
        cache_write?: number;
    };
    status?: string;
}
export declare function catalogModels(models: Array<{
    id?: unknown;
    name?: unknown;
}>, opts?: {
    catalog?: Record<string, ModelMeta>;
    freeOnly?: boolean;
    provider?: "opencode" | "opencode-go";
}): OpenCodeModelInfo[];
export declare function filterFreeModels(models: Array<{
    id?: unknown;
    name?: unknown;
}>, opts?: {
    catalog?: Record<string, ModelMeta>;
}): OpenCodeModelInfo[];
export interface CatalogResult {
    models: OpenCodeModelInfo[];
    checkedAt: number;
}
export interface OpenCodeCatalogs {
    zen: CatalogResult | null;
    go: CatalogResult | null;
}
export type DiscoveryOptions = {
    fetchFn?: typeof fetch;
    timeoutMs?: number;
    signal?: AbortSignal;
};
export declare function discoverCatalogs(opts?: DiscoveryOptions): Promise<OpenCodeCatalogs>;
export declare function discoverModels(opts?: DiscoveryOptions): Promise<OpenCodeModelInfo[]>;
export declare const CATALOG_REFRESH_INTERVAL_MS: number;
/** One shared request batch for the three providers. No failed request becomes a fresh catalog. */
export declare function createCatalogDiscovery(opts?: DiscoveryOptions): {
    current: () => OpenCodeCatalogs;
    refresh(force?: boolean, signal?: AbortSignal): Promise<OpenCodeCatalogs>;
};
export {};
