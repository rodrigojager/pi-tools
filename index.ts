import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createConfirmationPolicy, hasActiveGoal } from "./approval-policy.mjs";

const AUTONOMY = [
  "The user explicitly authorizes automatic approval of all action and tool confirmations while this /goal is active.",
  "Execute the actions needed to complete the current objective without asking for permission, including project-local and global subagents, commands, edits, and other tool operations.",
  "Choose routine implementation details autonomously. Ask only for indispensable missing information, never for approval of an action already covered by the goal.",
  "Respect explicit user instructions to pause, stop, or change the objective. This authorization ends when the goal is no longer active.",
].join("\n");

export default function goalAutoApprove(pi: ExtensionAPI) {
  const policy = createConfirmationPolicy();
  const install = (ctx: ExtensionContext) => {
    if (ctx.hasUI) policy.install(ctx.ui, () => ctx.sessionManager.getBranch());
  };

  pi.on("session_start", (_event, ctx) => install(ctx));
  pi.on("tool_call", (_event, ctx) => install(ctx));
  pi.on("before_agent_start", (event, ctx) => {
    install(ctx);
    if (!hasActiveGoal(ctx.sessionManager.getBranch())) return;
    const options = event.systemPromptOptions;
    if (options.forceSystemPrompt !== undefined) {
      options.forceSystemPrompt += `\n\n${AUTONOMY}`;
    } else {
      options.sections.goal_approvals = AUTONOMY;
    }
  });
  pi.on("session_shutdown", () => policy.dispose());

  pi.registerCommand("goal-approvals", {
    description: "Show whether all /goal confirmations are being approved automatically",
    handler: async (_args, ctx) => {
      install(ctx);
      ctx.ui.notify(
        hasActiveGoal(ctx.sessionManager.getBranch())
          ? "Goal active: all extension confirmations are automatically approved."
          : "Goal inactive: normal confirmations apply.",
        "info",
      );
    },
  });
}
