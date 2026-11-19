import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const TASK_DOCUMENT = /(?:^|[\\/])(?:tasks?|handoffs?)[\\/][^\\/]+\.(?:md|txt)$/i;
const JOINED_WORD = /(?<![A-Za-z0-9_\\/-])[a-z]{15,}(?![A-Za-z0-9_\\/-])/g;
const MIN_SUSPICIOUS_WORDS = 8;
const MIN_SUSPICIOUS_RATIO = 0.025;
const MAX_DOCUMENT_BYTES = 128 * 1024;

export function isTaskDocument(path) {
  return typeof path === "string" && TASK_DOCUMENT.test(path);
}

/** Heuristic only: reject dense clusters, never invent spaces inside source text. */
export function inspectSpacing(text) {
  if (typeof text !== "string" || text.length < 250) return null;
  const lines = text.split(/\r?\n/);
  let inFence = false;
  const prose = [];
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    prose.push(line.replace(/`[^`]*`/g, " ").replace(/https?:\/\/\S+/g, " "));
  }
  const plain = prose.join("\n");
  const suspicious = [...plain.matchAll(JOINED_WORD)].map((match) => match[0]);
  if (suspicious.length < MIN_SUSPICIOUS_WORDS) return null;
  const words = Math.max(1, [...plain.matchAll(/\b[A-Za-z]+\b/g)].length);
  if (suspicious.length / words < MIN_SUSPICIOUS_RATIO) return null;
  return { count: suspicious.length, examples: [...new Set(suspicious)].slice(0, 4) };
}

export function inspectTicketFile(cwd, ticketPath) {
  if (typeof cwd !== "string" || !isTaskDocument(ticketPath)) return null;
  const root = resolve(cwd);
  const target = resolve(root, ticketPath);
  try {
    const realTarget = realpathSync(target);
    const within = relative(realpathSync(root), realTarget);
    if (isAbsolute(within) || within === ".." || within.startsWith(`..\\`) || within.startsWith("../")) return null;
    if (statSync(realTarget).size > MAX_DOCUMENT_BYTES) return null;
    return inspectSpacing(readFileSync(realTarget, "utf8"));
  } catch {
    return null;
  }
}

export function spacingBlockReason(finding) {
  return `Task prose appears to contain joined words (${finding.count} suspects, e.g. ${finding.examples.join(", ")}). Rewrite it with normal spaces and retry. Preserve exact identifiers, paths, and hashes; do not auto-insert spaces into them.`;
}
