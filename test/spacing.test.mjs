import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import spacingGuard from "../index.ts";
import { inspectSpacing, inspectTicketFile, isTaskDocument } from "../spacing.mjs";

const broken = `Implement externalpublication after unresolveddataset review. Plan alreadyaccepted and immutableoldfeeds remainunchanged.
Require nonemptyevidence; missing operationalapproval orunknownstatusfails. Document operatorattestedfacts and responsibleforlicenseauthority.\n`;
const repaired = `Implement external publication after unresolved dataset review. Plan already accepted and immutable old feeds remain unchanged.
Require nonempty evidence; missing operational approval or unknown status fails. Document operator attested facts and responsibility for license authority.\n`;

test("detects dense joined prose and leaves readable prose alone", () => {
  assert.ok(inspectSpacing(broken)?.count >= 8);
  assert.equal(inspectSpacing(repaired), null);
});

test("ignores code fences, inline identifiers, and URLs", () => {
  const code = `Task details follow.\n\`\`\`text\n${broken}\n\`\`\`\nSee \`externalpublication\` and https://example.com/immutableoldfeeds for reference.`;
  assert.equal(inspectSpacing(code), null);
});

test("scans only local task documents", () => {
  assert.equal(isTaskDocument("D:/SpyBrowser/artifacts/goal/tasks/publication-prep.md"), true);
  assert.equal(isTaskDocument("D:/SpyBrowser/src/source.ts"), false);
  const root = mkdtempSync(join(tmpdir(), "pi-spacing-guard-"));
  try {
    const folder = join(root, "tasks");
    mkdirSync(folder);
    writeFileSync(join(folder, "handoff.md"), broken);
    assert.ok(inspectTicketFile(root, "tasks/handoff.md"));
    assert.equal(inspectTicketFile(root, "../outside/tasks/handoff.md"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("blocks malformed writes and subagent handoffs before execution", () => {
  let handler;
  spacingGuard({ on: (name, fn) => { assert.equal(name, "tool_call"); handler = fn; } });
  const ctx = { cwd: tmpdir() };
  assert.equal(handler({ toolName: "write", input: { path: "tasks/handoff.md", content: broken } }, ctx)?.block, true);
  assert.equal(handler({ toolName: "subagent", input: { task: broken } }, ctx)?.block, true);
  assert.equal(handler({ toolName: "write", input: { path: "tasks/handoff.md", content: repaired } }, ctx), undefined);
  assert.equal(handler({ toolName: "write", input: { path: "src/app.ts", content: broken } }, ctx), undefined);
});
