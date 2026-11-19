import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import type { OpenCodeCatalogs, createCatalogDiscovery } from "./discovery.js";
type Discovery = ReturnType<typeof createCatalogDiscovery>;
/** Refresh catalogs and session headers while retaining native auth and API engines. */
export declare function withOpenCodeCatalog(base: Provider, source: keyof OpenCodeCatalogs, discovery: Discovery): Provider & {
    getAllModels(): readonly Model<Api>[];
};
export {};
