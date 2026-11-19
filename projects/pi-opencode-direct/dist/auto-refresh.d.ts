import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export declare const OPENCODE_CATALOG_PROVIDERS: readonly ["opencode-direct", "opencode", "opencode-go"];
/** Startup, periodic refresh, and a freshness check after suspend/long idle. */
export declare function installAutoRefresh(pi: ExtensionAPI): void;
