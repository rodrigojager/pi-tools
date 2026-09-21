import { execFile } from "node:child_process";
import { parse, resolve } from "node:path";
import type { WorkspaceFile } from "./types.ts";

export interface WorkspaceData {
  branch: string | null;
  aheadCount: number;
  untrackedCount: number;
  files: WorkspaceFile[];
}

const CACHE_TTL_MS = 2000;
const empty = (): WorkspaceData => ({ branch: null, aheadCount: 0, untrackedCount: 0, files: [] });
export type GitRunner = (args: string[], cwd: string) => Promise<string | null>;

// No shell and no synchronous work on the renderer's call stack. Git cannot
// prompt, hold optional index locks, or create visible console windows.
export const runGit: GitRunner = (args, cwd) => new Promise((done) => {
  execFile("git", ["--no-optional-locks", ...args], {
    cwd, encoding: "utf8", timeout: 2000, maxBuffer: 512 * 1024,
    windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }, (error, stdout) => done(error ? null : stdout));
});

function parseStatus(out: string) {
  const records = out.split("\0");
  const header = records.shift() ?? "";
  const unborn = /^## (No commits yet on|Initial commit on) /.test(header);
  const branch = header.replace(/^## (?:(?:No commits yet on|Initial commit on) )?/, "").split("...")[0];
  let untrackedCount = 0;
  for (let i = 0; i < records.length; i++) {
    if (records[i].startsWith("?? ")) untrackedCount++;
    if (/[RC]/.test(records[i].slice(0, 2))) i++; // rename/copy has a second pathname
  }
  return { branch: branch || null, aheadCount: Number(header.match(/\bahead (\d+)/)?.[1] ?? 0), untrackedCount, unborn };
}

function parseNumstat(out: string): WorkspaceFile[] {
  const records = out.split("\0");
  const files: WorkspaceFile[] = [];
  for (let i = 0; i < records.length; i++) {
    const first = records[i].indexOf("\t");
    const second = records[i].indexOf("\t", first + 1);
    if (first < 0 || second < 0) continue;
    const added = parseInt(records[i].slice(0, first), 10);
    const removed = parseInt(records[i].slice(first + 1, second), 10);
    let path = records[i].slice(second + 1);
    if (!path) { i += 2; path = records[i]; } // old name, then new name
    if (path && !isNaN(added) && !isNaN(removed)) files.push({ path, added, removed });
  }
  return files.sort((a, b) => (b.added + b.removed) - (a.added + a.removed)).slice(0, 15);
}

export async function readWorkspace(cwd: string, git: GitRunner = runGit): Promise<WorkspaceData> {
  const top = await git(["rev-parse", "--show-toplevel"], cwd);
  if (!top) return empty();
  const root = resolve(top.replace(/[\r\n]+$/, ""));
  // An accidental C:\.git or /.git would otherwise scan the entire drive.
  if (root === parse(root).root) return empty();
  const status = await git(["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=normal"], cwd);
  if (status === null) return empty();
  const { unborn, ...data } = parseStatus(status);
  const stats = await git(["diff", "--numstat", "-z", ...(unborn ? ["--cached"] : ["HEAD"])], cwd);
  return { ...data, files: parseNumstat(stats ?? "") };
}

interface CacheEntry {
  data: WorkspaceData;
  expiresAt: number;
  generation: number;
  pending?: Promise<void>;
}

export class WorkspaceCache {
  private entries = new Map<string, CacheEntry>();
  private listeners = new Set<() => void>();
  private read: (cwd: string) => Promise<WorkspaceData>;
  private now: () => number;

  constructor(read = readWorkspace, now = Date.now) {
    this.read = read;
    this.now = now;
  }

  get(cwd: string | undefined): WorkspaceData {
    if (!cwd) return empty();
    const key = resolve(cwd);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { data: empty(), expiresAt: 0, generation: 0 };
      this.entries.set(key, entry);
      if (this.entries.size > 8) this.entries.delete(this.entries.keys().next().value!);
    }
    if (!entry.pending && this.now() >= entry.expiresAt) this.refresh(key, entry);
    return entry.data;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  invalidate(cwd?: string): void {
    const key = cwd ? resolve(cwd) : undefined;
    for (const [path, entry] of this.entries) {
      if (key && key !== path) continue;
      entry.expiresAt = 0;
      entry.generation++;
    }
  }

  private refresh(cwd: string, entry: CacheEntry): void {
    const generation = entry.generation;
    entry.pending = Promise.resolve().then(() => this.read(cwd)).then((data) => {
      if (this.entries.get(cwd) !== entry || generation !== entry.generation) return;
      entry.data = data;
      for (const listener of this.listeners) {
        try { listener(); } catch { /* a disposed UI cannot break cache refresh */ }
      }
    }).catch(() => {
      // Keep the previous snapshot on transient failures; retry after the TTL.
    }).finally(() => {
      entry.pending = undefined;
      entry.expiresAt = this.now() + CACHE_TTL_MS;
      if (this.entries.get(cwd) === entry && generation !== entry.generation) this.refresh(cwd, entry);
    });
  }
}

const cache = new WorkspaceCache();
export const getWorkspaceData = (cwd: string | undefined): WorkspaceData => cache.get(cwd);
export const invalidateWorkspaceCache = (cwd?: string): void => cache.invalidate(cwd);
export const onWorkspaceDataChanged = (listener: () => void): (() => void) => cache.subscribe(listener);
