import assert from "node:assert/strict";
import { test } from "node:test";
import { parse, resolve, join } from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { WorkspaceCache, readWorkspace, type WorkspaceData } from "../workspace.ts";

const snapshot = (branch: string): WorkspaceData => ({ branch, aheadCount: 0, untrackedCount: 0, files: [] });
const tick = () => new Promise<void>((done) => setImmediate(done));
function deferred<T>() {
  let done!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { done = resolve; });
  return { promise, done };
}

test("render returns immediately, coalesces requests and leaves the event loop responsive", async () => {
  const pending = deferred<WorkspaceData>();
  let calls = 0;
  const cache = new WorkspaceCache(async () => { calls++; return pending.promise; });
  let notifications = 0;
  const unsubscribe = cache.subscribe(() => { notifications++; });
  for (let i = 0; i < 1000; i++) assert.equal(cache.get("project")?.branch, null);
  assert.equal(calls, 0, "even process creation is deferred beyond the render stack");
  await tick();
  assert.equal(calls, 1);
  assert.equal(notifications, 0);
  pending.done(snapshot("main"));
  await tick();
  assert.equal(cache.get("project").branch, "main");
  assert.equal(notifications, 1);
  unsubscribe();
  cache.invalidate();
  cache.get("project");
  await tick();
  assert.equal(notifications, 1);
});

test("cache belongs to each directory and expires from completion", async () => {
  let now = 0;
  const requests: { cwd: string; result: ReturnType<typeof deferred<WorkspaceData>> }[] = [];
  const cache = new WorkspaceCache((cwd) => {
    const result = deferred<WorkspaceData>();
    requests.push({ cwd, result });
    return result.promise;
  }, () => now);
  cache.get("alpha");
  cache.get("beta");
  await tick();
  assert.deepEqual(requests.map((r) => r.cwd), [resolve("alpha"), resolve("beta")]);
  now = 5000;
  requests[0].result.done(snapshot("alpha-branch"));
  requests[1].result.done(snapshot("beta-branch"));
  await tick();
  now = 6999;
  assert.equal(cache.get("alpha").branch, "alpha-branch");
  assert.equal(cache.get("beta").branch, "beta-branch");
  await tick();
  assert.equal(requests.length, 2);
  now = 7000;
  assert.equal(cache.get("alpha").branch, "alpha-branch", "stale snapshot remains visible");
  await tick();
  assert.equal(requests.length, 3);
  requests[2].result.done(snapshot("new-alpha"));
  await tick();
  assert.equal(cache.get("alpha").branch, "new-alpha");
  assert.equal(cache.get("beta").branch, "beta-branch");
  await tick();
  requests[3].result.done(snapshot("new-beta"));
  await tick();
});

test("invalidation discards an in-flight stale result and queues only one refresh", async () => {
  const pending = [deferred<WorkspaceData>(), deferred<WorkspaceData>()];
  let calls = 0;
  let notifications = 0;
  const cache = new WorkspaceCache(() => pending[calls++].promise);
  cache.subscribe(() => notifications++);
  cache.get("project");
  await tick();
  for (let i = 0; i < 10; i++) { cache.invalidate("project"); cache.get("project"); }
  assert.equal(calls, 1);
  pending[0].done(snapshot("stale"));
  await tick();
  assert.equal(cache.get("project").branch, null);
  assert.equal(notifications, 0);
  assert.equal(calls, 2);
  pending[1].done(snapshot("fresh"));
  await tick();
  assert.equal(cache.get("project").branch, "fresh");
  assert.equal(notifications, 1);
});

test("reader failure is throttled and listener failure does not reject refresh", async () => {
  let now = 0;
  let calls = 0;
  const cache = new WorkspaceCache(async () => {
    if (++calls === 1) throw new Error("git unavailable");
    return snapshot("main");
  }, () => now);
  cache.subscribe(() => { throw new Error("UI disposed"); });
  cache.get("project");
  await tick();
  for (let i = 0; i < 100; i++) cache.get("project");
  assert.equal(calls, 1);
  now = 2000;
  cache.get("project");
  await tick();
  assert.equal(cache.get("project").branch, "main");
});

test("missing repository and filesystem-root repository never run status/diff", async () => {
  for (const top of [null, `${parse(resolve(".")).root}\n`]) {
    const calls: string[][] = [];
    const data = await readWorkspace(resolve("."), async (args) => { calls.push(args); return top; });
    assert.equal(data.branch, null);
    assert.deepEqual(calls, [["rev-parse", "--show-toplevel"]]);
  }
});

test("porcelain branch data replaces rev-list; NUL paths and renames stay intact", async () => {
  const cwd = resolve("project with spaces & symbols");
  const calls: string[][] = [];
  const data = await readWorkspace(cwd, async (args, actualCwd) => {
    assert.equal(actualCwd, cwd);
    calls.push(args);
    if (args[0] === "rev-parse") return `${cwd}\n`;
    if (args[0] === "status") return "## main...origin/main [ahead 3, behind 2]\0?? new\nfile.txt\0R  renamed\0?? old-name\0";
    return ["2\t1\tfile\twith-tab.txt", "-\t-\tbinary.png", "10\t2\t", "old.txt", "new.txt", ""].join("\0");
  });
  assert.equal(data.branch, "main");
  assert.equal(data.aheadCount, 3);
  assert.equal(data.untrackedCount, 1);
  assert.deepEqual(data.files, [{ path: "new.txt", added: 10, removed: 2 }, { path: "file\twith-tab.txt", added: 2, removed: 1 }]);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2], ["diff", "--numstat", "-z", "HEAD"]);
});

test("unborn branch uses cached diff without querying a nonexistent HEAD", async () => {
  const calls: string[][] = [];
  const data = await readWorkspace(resolve("new-project"), async (args, cwd) => {
    calls.push(args);
    if (args[0] === "rev-parse") return cwd;
    if (args[0] === "status") return "## No commits yet on main\0A  new.txt\0";
    return "4\t0\tnew.txt\0";
  });
  assert.equal(data.branch, "main");
  assert.deepEqual(calls[2], ["diff", "--numstat", "-z", "--cached"]);
  assert.equal(data.files[0].added, 4);
});

test("real Git repository: unborn, committed and modified files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-sidebar-git-test-"));
  const exec = promisify(execFile);
  const git = (...args: string[]) => exec("git", args, { cwd, windowsHide: true });
  await git("init", "-b", "main");
  await writeFile(join(cwd, "tracked.txt"), "first\n");
  await git("add", "tracked.txt");
  const unborn = await readWorkspace(cwd);
  assert.equal(unborn.branch, "main");
  assert.equal(unborn.files[0].added, 1);
  await git("-c", "user.name=Sidebar Test", "-c", "user.email=sidebar@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "test");
  await writeFile(join(cwd, "tracked.txt"), "first\nsecond\n");
  await writeFile(join(cwd, "new file.txt"), "new\n");
  const modified = await readWorkspace(cwd);
  assert.equal(modified.untrackedCount, 1);
  assert.deepEqual(modified.files, [{ path: "tracked.txt", added: 1, removed: 0 }]);
});
