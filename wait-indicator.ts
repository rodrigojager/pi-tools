// Presentation only: the saved goal state remains owned by pi-goal.
export const WAIT_WIDGET_KEY = "goal-wait-indicator";
export const WAIT_INTERVAL_MS = 500;

export function latestWaitingGoal(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type !== "custom" || entry.customType !== "goal-state") continue;
    const goal = entry.data?.goal;
    if (goal?.status !== "active" || typeof goal.waiting?.reason !== "string") return undefined;
    return { id: goal.id, reason: goal.waiting.reason.replace(/\s+/g, " ").trim(), resumeAt: goal.waiting.resumeAt };
  }
  return undefined;
}

export function renderGoalWait(wait, elapsedMs, width, theme, truncate) {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const elapsed = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
  // Alternating hourglass and brightness distinguish a quiet wait from model work.
  const phase = Math.floor(elapsedMs / WAIT_INTERVAL_MS) % 2;
  const icon = theme.fg(phase ? "accent" : "dim", phase ? "⌛" : "⏳");
  return [truncate(`${icon} [GOAL] aguardando · ${elapsed} · ${wait.reason}`, Math.max(1, width), "…")];
}

export class GoalWaitIndicator {
  context;
  tui;
  timer;
  wait;
  startedAt = 0;
  leafId;
  sessionId;
  visible = false;

  constructor(truncate, clock = Date.now, schedule = setInterval, cancel = clearInterval) {
    this.truncate = truncate;
    this.clock = clock;
    this.schedule = schedule;
    this.cancel = cancel;
  }

  refresh(ctx) {
    if (!ctx.hasUI) return;
    const sessionId = ctx.sessionManager.getSessionId();
    if (this.sessionId !== sessionId) this.dispose();
    this.context = ctx;
    this.sessionId = sessionId;
    this.leafId = ctx.sessionManager.getLeafId?.();
    const wait = latestWaitingGoal(ctx.sessionManager.getBranch?.() ?? []);
    if (!wait) { this.clear(); return; }
    if (!this.wait || this.wait.id !== wait.id || this.wait.reason !== wait.reason || this.wait.resumeAt !== wait.resumeAt) this.startedAt = this.clock();
    this.wait = wait;
    if (!this.visible) {
      this.visible = true;
      ctx.ui.setWidget(WAIT_WIDGET_KEY, (tui, theme) => {
        this.tui = tui;
        return { invalidate() {}, render: width => this.wait ? renderGoalWait(this.wait, this.clock() - this.startedAt, width, theme, this.truncate) : [] };
      }, { placement: "aboveEditor" });
    }
    this.timer ??= this.schedule(() => {
      // A local leaf pointer detects slash-command state changes. No agent,
      // process, network or model requests; read the branch only when it changed.
      if (this.context.sessionManager.getLeafId?.() !== this.leafId) this.refresh(this.context);
      this.tui?.requestRender();
    }, WAIT_INTERVAL_MS);
    this.timer?.unref?.();
    this.tui?.requestRender();
  }

  clear() {
    if (this.timer !== undefined) this.cancel(this.timer);
    this.timer = undefined;
    if (this.visible) this.context?.ui.setWidget(WAIT_WIDGET_KEY, undefined);
    this.visible = false;
    this.wait = undefined;
    this.tui = undefined;
  }

  dispose() {
    this.clear();
    this.context = undefined;
    this.sessionId = undefined;
    this.leafId = undefined;
  }
}

export function registerGoalWaitIndicator(pi, truncate) {
  const indicator = new GoalWaitIndicator(truncate);
  for (const event of ["session_start", "session_switch", "session_tree", "session_fork", "tool_execution_end", "agent_end", "message_end"]) {
    pi.on(event, (_event, ctx) => indicator.refresh(ctx));
  }
  pi.on("agent_start", () => indicator.clear());
  pi.on("session_shutdown", () => indicator.dispose());
  return indicator;
}
