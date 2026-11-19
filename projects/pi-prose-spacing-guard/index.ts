import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { inspectSpacing, inspectTicketFile, isTaskDocument, spacingBlockReason } from "./spacing.mjs";

export default function proseSpacingGuard(pi: ExtensionAPI): void {
  pi.on("tool_call", (event, ctx) => {
    let finding = null;
    if (event.toolName === "write" && isTaskDocument(event.input.path)) {
      finding = inspectSpacing(event.input.content);
    } else if (event.toolName === "subagent") {
      const input = event.input as { task?: unknown; ticketPath?: unknown };
      finding = inspectSpacing(input.task);
      if (!finding && typeof input.ticketPath === "string") {
        finding = inspectTicketFile(ctx.cwd, input.ticketPath);
      }
    }
    if (finding) return { block: true, reason: spacingBlockReason(finding) };
  });
}
