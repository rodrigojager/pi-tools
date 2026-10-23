// SPDX-License-Identifier: GPL-3.0-or-later
/** Live catalog/host check: public GET requests only, isolated persistent store, no inference or real credentials. */
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import extension from "../dist/index.js";

const sdk = await import(process.env.PI_CATALOG_SMOKE_SDK
  ? pathToFileURL(process.env.PI_CATALOG_SMOKE_SDK).href
  : "@earendil-works/pi-coding-agent");
const fixture = mkdtempSync(join(tmpdir(), "pi-opencode-catalog-"));
const handlers = new Map<string, (...args: any[]) => any>();
try {
  const runtime = await sdk.ModelRuntime.create({
    authPath: join(fixture, "auth.json"), modelsPath: join(fixture, "models.json"),
    modelsStorePath: join(fixture, "models-store.json"), allowModelNetwork: false,
  });
  const registry = new sdk.ModelRegistry(runtime);
  await extension({
    registerProvider(id: any, config?: any) {
      if (typeof id === "string") registry.registerProvider(id, config);
      else registry.registerProvider(id);
    },
    on(event: string, handler: any) { handlers.set(event, handler); },
  } as any);
  const ctx = { modelRegistry: registry, hasUI: false };
  await handlers.get("session_start")!({}, ctx);
  for (const provider of ["opencode-direct", "opencode", "opencode-go"]) {
    const models = registry.getAll().filter((m: any) => m.provider === provider);
    assert.ok(models.length > 0, `Missing live catalog: ${provider}`);
    assert.equal(new Set(models.map((m: any) => m.id)).size, models.length);
    console.log(JSON.stringify({ provider, count: models.length,
      deepseek: models.filter((m: any) => m.id.includes("deepseek")).map((m: any) => ({ id: m.id, baseUrl: m.baseUrl })),
    }));
  }
  const go = registry.find("opencode-go", "deepseek-v4.1-flash");
  assert.equal(go?.baseUrl, "https://opencode.ai/zen/go/v1");
  assert.equal(registry.find("opencode", "gpt-6.1-sol")?.api, "openai-responses");
  assert.equal(registry.find("opencode-direct", "deepseek-v4-flash-free"), undefined);
  assert.equal(registry.find("opencode", "hy3-free"), undefined, "retired static IDs must not survive the live catalog");
  await handlers.get("before_agent_start")!({}, ctx);
  console.log("PASS: automatic startup, persistence and native routing in the real Pi host; no inference requests.");
} finally {
  handlers.get("session_shutdown")?.();
  const absoluteFixture = realpathSync(fixture);
  assert.equal(dirname(absoluteFixture), realpathSync(tmpdir()));
  assert.ok(basename(absoluteFixture).startsWith("pi-opencode-catalog-"));
  rmSync(absoluteFixture, { recursive: true, force: true });
}
