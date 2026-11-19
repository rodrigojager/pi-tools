// SPDX-License-Identifier: GPL-3.0-or-later
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CATALOG_REFRESH_INTERVAL_MS } from "./discovery.js";

export const OPENCODE_CATALOG_PROVIDERS = ["opencode-direct", "opencode", "opencode-go"] as const;

/** Startup, periodic refresh, and a freshness check after suspend/long idle. */
export function installAutoRefresh(pi: ExtensionAPI): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let controller: AbortController | undefined;
  let pending: Promise<void> | undefined;
  let lastAttempt = 0;
  let warned = false;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
    pending = undefined;
  };
  const refresh = (ctx: ExtensionContext, force = false): Promise<void> => {
    if (!controller || controller.signal.aborted || process.env.PI_OFFLINE !== undefined) return Promise.resolve();
    if (pending) return pending;
    if (!force && lastAttempt && Date.now() - lastAttempt < CATALOG_REFRESH_INTERVAL_MS) return Promise.resolve();
    lastAttempt = Date.now();
    const active = controller;
    const task = ctx.modelRegistry.refresh({
      providers: OPENCODE_CATALOG_PROVIDERS, allowNetwork: true,
      signal: AbortSignal.any([active.signal, AbortSignal.timeout(15_000)]),
    }).then(result => {
      if (active.signal.aborted) return;
      if (result.errors.size && ctx.hasUI && !warned) {
        ctx.ui.notify("OpenCode: falha ao atualizar catálogo. Mantendo o último catálogo válido; nova tentativa automática em 5 minutos.", "warning");
      }
      warned = result.errors.size > 0;
    }).catch(() => {
      if (!active.signal.aborted && ctx.hasUI && !warned) {
        ctx.ui.notify("OpenCode: catálogo indisponível. Nova tentativa automática em 5 minutos.", "warning");
        warned = true;
      }
    }).finally(() => { if (pending === task) pending = undefined; });
    pending = task;
    return task;
  };
  pi.on("session_start", async (_event, ctx) => {
    stop();
    lastAttempt = 0;
    const active = new AbortController();
    controller = active;
    await refresh(ctx, true);
    if (controller !== active || active.signal.aborted || process.env.PI_OFFLINE !== undefined) return;
    timer = setInterval(() => { void refresh(ctx); }, CATALOG_REFRESH_INTERVAL_MS);
    timer.unref?.();
  });
  pi.on("before_agent_start", async (_event, ctx) => { await refresh(ctx); });
  pi.on("session_shutdown", stop);
}
