import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MutateError,
  applyEdit,
  classify,
  detect,
  interrupt,
  main,
  parseArgs,
  putBack,
  snapshot,
} from "../skills/test-prover/mutate.mjs";

const helperPath = fileURLToPath(new URL("../skills/test-prover/mutate.mjs", import.meta.url));

function git(cwd, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
    encoding: "utf8",
  });
}

const GUARD_BASE = "export function allowed(n) {\n  return true;\n}\n";
const GUARD_FIX = "export function allowed(n) {\n  return n >= 0 && n < 10;\n}\n";
const GUARD_TEST = [
  'import assert from "node:assert/strict";',
  'import test from "node:test";',
  'import { allowed } from "./guard.mjs";',
  'test("rejects a negative", () => assert.equal(allowed(-1), false));',
  'test("accepts zero", () => assert.equal(allowed(0), true));',
  'test("rejects ten", () => assert.equal(allowed(10), false));',
  "",
].join("\n");
const CRLF_SOURCE = "export const value = 1;\r\nexport const other = 2;\r\n";
// Exits 0 only when crlf.mjs holds the edited line with its CRLF ending.
const CHECK_CRLF = [
  'import { readFileSync } from "node:fs";',
  'const text = readFileSync("crlf.mjs", "utf8");',
  'process.exit(text.includes("value = 3;\\r\\nexport const other") ? 0 : 1);',
  "",
].join("\n");
// Exits 1 when the file named by its argument exists, 0 when it does not.
const ABSENT = [
  'import { existsSync } from "node:fs";',
  "process.exit(existsSync(process.argv[2]) ? 1 : 0);",
  "",
].join("\n");

// A new folder in the system's temporary folder, removed when the test ends, pass or fail. The
// removal is registered before anything is made inside it, and retried: on Windows a file a test
// just ran or wrote can stay locked for a moment, and a removal that throws then leaves the folder.
function tempDir(t, prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

// A repository with a base commit (the bug) and a fix commit on top (the fix, its tests and a new
// helper file), so HEAD~1 is the base.
function fixtureRepo(t) {
  const dir = tempDir(t, "test-prover-fixture-");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "core.autocrlf", "false");
  const write = (name, text) => {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  };
  write("guard.mjs", GUARD_BASE);
  write("crlf.mjs", CRLF_SOURCE);
  write("check-crlf.mjs", CHECK_CRLF);
  write("absent.mjs", ABSENT);
  write("fail.mjs", "process.exit(3);\n");
  write("hang.mjs", "setTimeout(() => {}, 60000);\n");
  write("no-tests.mjs", 'console.log("No test files found, exiting with code 0");\n');
  write("touch.mjs", 'import { writeFileSync } from "node:fs";\nwriteFileSync("ran.txt", "x");\n');
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  write("guard.mjs", GUARD_FIX);
  write("guard.test.mjs", GUARD_TEST);
  write("lib/helper.mjs", "export const helper = 1;\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "fix");
  return dir;
}

async function scratch(t, repo) {
  const made = await main(["setup", "--repo", repo]);
  t.after(() => main(["teardown", "--root", made.root]).catch(() => {}));
  return made;
}

const bytes = (root, name) => readFileSync(path.join(root, name));

test("parseArgs reads each command and refuses what does not fit it", () => {
  const options = parseArgs([
    "edit",
    "--root",
    "/w",
    "--file",
    "a.mjs",
    "--search",
    "x",
    "--replace",
    "y",
    "--command",
    "node --test",
    "--zero-match",
    "nothing ran",
    "--timeout",
    "30",
  ]);
  assert.equal(options.command, "edit");
  assert.equal(options.timeoutMs, 30000);
  assert.deepEqual(options.zeroMatch, ["nothing ran"]);
  assert.throws(() => parseArgs(["mutate"]), /expected one of/);
  assert.throws(() => parseArgs(["run", "--root", "/w"]), /--command/);
  assert.throws(() => parseArgs(["edit", "--root", "/w", "--command", "x", "--file", "a"]), /--search/);
  assert.throws(() => parseArgs(["revert", "--root", "/w", "--command", "x", "--file", "a"]), /--base/);
  assert.throws(() => parseArgs(["setup"]), /--repo/);
  assert.throws(() => parseArgs(["run", "--root", "/w", "--command", "x", "--timeout", "soon"]), /seconds/);
  assert.throws(() => parseArgs(["run", "--root"]), /needs a value/);
});

test("applyEdit replaces exactly one occurrence and keeps the file's line endings", () => {
  assert.equal(applyEdit("a < b\n", "<", "<="), "a <= b\n");
  assert.equal(
    applyEdit("one\r\ntwo\r\nthree\r\n", "one\ntwo", "one\nTWO\nmore"),
    "one\r\nTWO\r\nmore\r\nthree\r\n",
    "an LF search and replace match and write CRLF in a CRLF file",
  );
  assert.equal(applyEdit("x == 1 || x == 1\n", "x == 1", "x != 1", 2), "x == 1 || x != 1\n");
  assert.throws(() => applyEdit("abc\n", "zzz", "y"), /not found/);
  assert.throws(() => applyEdit("x x\n", "x", "y"), /2 times.*--occurrence/);
  assert.throws(() => applyEdit("x x\n", "x", "y", 3), /occurrence 3/);
  assert.throws(() => applyEdit("x\n", "x", "x"), /changes nothing/);
});

test("detect reads zero-match signatures and test counts from common runners", () => {
  assert.deepEqual(detect("# tests 3\n# pass 3\n"), { zeroMatch: null, testCount: 3 });
  assert.equal(detect("ℹ tests 0\nℹ pass 0\n").testCount, 0);
  assert.equal(detect(" Test Files  1 passed (1)\n      Tests  4 passed (4)\n").testCount, 4);
  assert.equal(detect("Tests:       1 failed, 2 passed, 3 total\n").testCount, 3);
  assert.equal(detect("Total tests: 5\n     Passed: 5\n").testCount, 5);
  assert.equal(detect("Passed!  - Failed:     0, Passed:     2, Skipped:     0, Total:     2").testCount, 2);
  assert.equal(detect("Running 6 tests using 2 workers\n").testCount, 6);
  assert.match(detect("No test files found, exiting with code 1\n").zeroMatch, /no test files found/i);
  assert.match(detect("No test suite found in file src/a.test.ts\n").zeroMatch, /no test suite found/i);
  assert.match(detect("testing: warning: no tests to run\nPASS\n").zeroMatch, /no tests to run/i);
  assert.match(detect("No test matches the given testcase filter `X`\n").zeroMatch, /no test matches/i);
  assert.match(detect("===== no tests ran in 0.01s =====\n").zeroMatch, /no tests ran/i);
  assert.equal(detect("\u001b[32m# tests 2\u001b[39m\n").testCount, 2, "colour codes are stripped");
  assert.equal(detect("Zero tests ran\n", { zeroMatch: ["zero tests ran"] }).zeroMatch, "zero tests ran");
  assert.equal(detect("ran=7 ok\n", { count: ["ran=([0-9]+)"] }).testCount, 7);
  assert.deepEqual(detect("all good\n"), { zeroMatch: null, testCount: null });
});

test("detect sees node's runner count a test file whose filter matched nothing as one passing test", () => {
  // node --test --test-name-pattern=<no match> <file>: the file itself is the one "test".
  const spec = "✔ scripts\\postgres-pin-policy.test.mjs (55.3ms)\nℹ tests 1\nℹ pass 1\nℹ fail 0\n";
  assert.match(detect(spec).zeroMatch, /test file/);
  const tap = "TAP version 13\n1..0\n# Subtest: scripts/a.test.mjs\nok 1 - scripts/a.test.mjs\n1..1\n# tests 1\n# pass 1\n";
  assert.match(detect(tap).zeroMatch, /1\.\.0/);
  const matched = "✔ release history is exempt (1.2ms)\nℹ tests 1\nℹ pass 1\n";
  assert.equal(detect(matched).zeroMatch, null, "a named test passing is a match");
  const crashed = "✖ scripts/a.test.mjs (40ms)\n  SyntaxError: Unexpected token\nℹ tests 1\nℹ fail 1\n";
  assert.equal(detect(crashed).zeroMatch, null, "a file that fails to load is red, not zero-match");
});

test("classify names the outcome of a run", () => {
  assert.equal(classify({ exitCode: 1, timedOut: false, zeroMatch: null, testCount: 3 }), "red");
  assert.equal(classify({ exitCode: 0, timedOut: false, zeroMatch: null, testCount: 3 }), "green");
  assert.equal(classify({ exitCode: 0, timedOut: false, zeroMatch: null, testCount: 0 }), "zero-match");
  assert.equal(classify({ exitCode: 1, timedOut: false, zeroMatch: "no tests found", testCount: null }), "zero-match");
  assert.equal(classify({ exitCode: null, timedOut: true, zeroMatch: null, testCount: null }), "timeout");
});

test("setup makes a scratch worktree at HEAD carrying the uncommitted work, and teardown removes it", async (t) => {
  const repo = fixtureRepo(t);
  writeFileSync(path.join(repo, "guard.mjs"), `${GUARD_FIX}// uncommitted\n`);
  writeFileSync(path.join(repo, "untracked.mjs"), "export const u = 1;\n");
  rmSync(path.join(repo, "fail.mjs"));
  const statusBefore = git(repo, "status", "--porcelain");
  const made = await main(["setup", "--repo", repo]);
  try {
    assert.equal(made.head, git(repo, "rev-parse", "HEAD").trim());
    assert.ok(!made.root.includes("\\"), "the root is printed with forward slashes");
    assert.equal(bytes(made.root, "guard.mjs").toString(), `${GUARD_FIX}// uncommitted\n`);
    assert.equal(bytes(made.root, "untracked.mjs").toString(), "export const u = 1;\n");
    assert.equal(existsSync(path.join(made.root, "fail.mjs")), false);
    assert.deepEqual([...made.copied].sort(), ["guard.mjs", "untracked.mjs"]);
    assert.deepEqual(made.deleted, ["fail.mjs"]);
    assert.equal(git(repo, "status", "--porcelain"), statusBefore, "the live checkout is untouched");
  } finally {
    const removed = await main(["teardown", "--root", made.root]);
    assert.equal(removed.removed, true);
  }
  assert.equal(existsSync(made.root), false);
  assert.equal(git(repo, "worktree", "list", "--porcelain").match(/^worktree /gm).length, 1, "the worktree is pruned");
  assert.equal(git(repo, "status", "--porcelain"), statusBefore);
});

test("setup links dependency folders from the checkout, and teardown leaves their contents alone", async (t) => {
  const repo = fixtureRepo(t);
  mkdirSync(path.join(repo, "node_modules", "dep"), { recursive: true });
  writeFileSync(path.join(repo, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n");
  git(repo, "add", ".gitignore");
  git(repo, "commit", "-q", "-m", "ignore");
  const made = await main(["setup", "--repo", repo, "--link", "node_modules"]);
  assert.deepEqual(made.linked, ["node_modules"]);
  assert.equal(bytes(made.root, "node_modules/dep/index.js").toString(), "module.exports = 1;\n");
  await main(["teardown", "--root", made.root]);
  assert.equal(readFileSync(path.join(repo, "node_modules", "dep", "index.js"), "utf8"), "module.exports = 1;\n");
});

test("edit runs the command against the mutated file and restores its bytes", async (t) => {
  const repo = fixtureRepo(t);
  const { root } = await scratch(t, repo);
  const before = bytes(root, "guard.mjs");
  const result = await main([
    "edit",
    "--root",
    root,
    "--file",
    "guard.mjs",
    "--search",
    "n >= 0",
    "--replace",
    "n > 0",
    "--command",
    "node --test guard.test.mjs",
  ]);
  assert.equal(result.outcome, "red");
  assert.equal(result.testCount, 3);
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.restored, true);
  assert.ok(bytes(root, "guard.mjs").equals(before));
  const survivor = await main([
    "edit",
    "--root",
    root,
    "--file",
    "guard.mjs",
    "--search",
    "n < 10",
    "--replace",
    "n <= 10",
    "--command",
    "node --test guard.test.mjs",
  ]);
  assert.equal(survivor.outcome, "red", "allowed(10) is asserted false, so the boundary swap is killed");
});

test("edit reads its search and replace from a JSON file and keeps CRLF", async (t) => {
  const repo = fixtureRepo(t);
  const { root } = await scratch(t, repo);
  const before = bytes(root, "crlf.mjs");
  assert.ok(before.toString().includes("\r\n"));
  const spec = path.join(path.dirname(root), "edit.json");
  writeFileSync(spec, JSON.stringify({ file: "crlf.mjs", search: "value = 1;\nexport const other", replace: "value = 3;\nexport const other" }));
  const result = await main(["edit", "--root", root, "--edit", spec, "--command", "node check-crlf.mjs"]);
  assert.equal(result.exitCode, 0, "the command saw the edit with CRLF endings");
  assert.equal(result.outcome, "green");
  assert.ok(bytes(root, "crlf.mjs").equals(before), "the original CRLF bytes are back");
});

test("a run that matched no tests is zero-match, not green", async (t) => {
  const repo = fixtureRepo(t);
  const { root } = await scratch(t, repo);
  const result = await main(["run", "--root", root, "--command", "node no-tests.mjs"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.outcome, "zero-match");
  assert.match(result.zeroMatch, /no test files found/i);
  const proven = await main(["run", "--root", root, "--command", "node --test guard.test.mjs"]);
  assert.equal(proven.outcome, "green");
  assert.equal(proven.testCount, 3);
});

test("the file is restored when the command fails or times out", async (t) => {
  const repo = fixtureRepo(t);
  const { root } = await scratch(t, repo);
  const before = bytes(root, "guard.mjs");
  const edit = ["edit", "--root", root, "--file", "guard.mjs", "--search", "n < 10", "--replace", "n < 11"];
  const failed = await main([...edit, "--command", "node fail.mjs"]);
  assert.equal(failed.exitCode, 3);
  assert.equal(failed.outcome, "red");
  assert.ok(bytes(root, "guard.mjs").equals(before));
  const started = Date.now();
  const slow = await main([...edit, "--command", "node hang.mjs", "--timeout", "2"]);
  assert.equal(slow.outcome, "timeout");
  assert.equal(slow.timedOut, true);
  assert.ok(Date.now() - started < 30000, "the process tree is killed at the timeout");
  assert.ok(bytes(root, "guard.mjs").equals(before));
  const missing = await main([...edit, "--command", "no-such-command-anywhere-xyz"]);
  assert.equal(missing.outcome, "error", "a command that never ran proves nothing");
  assert.ok(bytes(root, "guard.mjs").equals(before));
  const badCwd = await main([...edit, "--cwd", "no-such-folder", "--command", "node fail.mjs"]);
  assert.equal(badCwd.outcome, "error");
  assert.equal(badCwd.exitCode, null);
  assert.ok(bytes(root, "guard.mjs").equals(before));
});

test("a run that never finished on its own is an error, not red", () => {
  assert.equal(classify({ exitCode: null, signal: "SIGKILL", timedOut: false, zeroMatch: null, testCount: null }), "error");
  assert.equal(classify({ exitCode: null, signal: null, timedOut: false, zeroMatch: null, testCount: null }), "error");
  assert.equal(classify({ exitCode: 127, timedOut: false, zeroMatch: null, testCount: null }), "error", "sh: command not found");
  assert.equal(classify({ exitCode: 9009, timedOut: false, zeroMatch: null, testCount: null }), "error", "cmd: not recognized");
});

test("a failing run that counted tests is red, whatever its messages say", () => {
  // A mutation of detect() makes this repository's own test print a signature inside an assertion.
  const output = [
    "✖ detect reads zero-match signatures and test counts from common runners (1.2ms)",
    "  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /no test files found/i. Input:",
    "  'null'",
    "ℹ tests 15",
    "ℹ pass 14",
    "ℹ fail 1",
  ].join("\n");
  const seen = detect(output);
  assert.equal(seen.zeroMatch, null, "a signature inside a message is not the runner's summary");
  assert.equal(seen.testCount, 15);
  assert.equal(classify({ exitCode: 1, timedOut: false, ...seen }), "red");
  assert.equal(
    classify({ exitCode: 1, timedOut: false, zeroMatch: "no tests found", testCount: 4 }),
    "red",
    "a nonzero exit with tests counted is red even when a signature was seen",
  );
  assert.equal(detect("  FAIL  src/a.test.ts\nError: No test suite found in file src/a.test.ts\n").zeroMatch, "no test suite found");
  assert.equal(detect("?   \texample.com/pkg\t[no test files]\n").zeroMatch, "[no test files]");
  assert.equal(detect("ok  \texample.com/pkg\t0.01s [no tests to run]\n").zeroMatch, "[no tests to run]");
  assert.equal(detect("log: retrying because no tests found yet\n").zeroMatch, null);
  assert.equal(detect("Zero tests ran\n", { zeroMatch: ["zero tests ran"] }).zeroMatch, "zero tests ran");
  assert.equal(detect("note: zero tests ran\n", { zeroMatch: ["zero tests ran"] }).zeroMatch, null);
});

test("detect counts pytest's and go test -v's tests", () => {
  assert.equal(detect("collected 5 items / 2 deselected / 3 selected\n==== 1 failed, 2 passed, 2 deselected in 0.05s ====\n").testCount, 3);
  assert.equal(detect("============ 4 passed, 1 skipped, 2 warnings in 1.20s (0:00:01) ============\n").testCount, 5);
  const go = [
    "=== RUN   TestA",
    "--- PASS: TestA (0.00s)",
    "=== RUN   TestB",
    "=== RUN   TestB/case",
    "    --- FAIL: TestB/case (0.00s)",
    "--- FAIL: TestB (0.00s)",
    "FAIL",
  ].join("\n");
  assert.equal(detect(go).testCount, 3);
});

test("the command runs in bash, so the same command line works on every machine", async (t) => {
  const repo = fixtureRepo(t);
  const { root } = await scratch(t, repo);
  writeFileSync(path.join(root, "env.mjs"), "process.exit(process.env.GREETING === 'a b' ? 0 : 1);\n");
  const result = await main(["run", "--root", root, "--command", "GREETING='a b' node env.mjs && echo $((1+1)) ran"]);
  assert.equal(result.exitCode, 0, JSON.stringify(result.tail));
  assert.ok(result.tail.includes("2 ran"));
  assert.match(result.shell, /bash/);
});

test("an interrupt kills the running command and puts the files back", async (t) => {
  const repo = fixtureRepo(t);
  const { root } = await scratch(t, repo);
  const before = bytes(root, "guard.mjs");
  writeFileSync(
    path.join(root, "hang-pid.mjs"),
    'import { writeFileSync } from "node:fs";\nwriteFileSync("pid.txt", String(process.pid));\nsetTimeout(() => {}, 60000);\n',
  );
  const started = Date.now();
  const running = main([
    "edit", "--root", root, "--file", "guard.mjs", "--search", "n < 10", "--replace", "n < 11",
    "--command", "node hang-pid.mjs", "--timeout", "60",
  ]);
  while (!existsSync(path.join(root, "pid.txt"))) await new Promise((resolve) => setTimeout(resolve, 100));
  const pid = Number(readFileSync(path.join(root, "pid.txt"), "utf8"));
  assert.notEqual(bytes(root, "guard.mjs").toString(), before.toString(), "the edit is in place while the command runs");
  interrupt();
  assert.ok(bytes(root, "guard.mjs").equals(before), "the interrupt puts the file back at once");
  const result = await running;
  assert.ok(Date.now() - started < 30000, "the command was killed, not waited for");
  assert.notEqual(result.outcome, "green");
  assert.ok(bytes(root, "guard.mjs").equals(before));
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  for (let i = 0; i < 50 && alive(); i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(alive(), false, "the command's process is gone");
});

test("revert runs against the base version of each file and restores the fix", async (t) => {
  const repo = fixtureRepo(t);
  const { root } = await scratch(t, repo);
  const before = bytes(root, "guard.mjs");
  const result = await main([
    "revert",
    "--root",
    root,
    "--base",
    "HEAD~1",
    "--file",
    "guard.mjs",
    "--command",
    "node --test guard.test.mjs",
  ]);
  assert.equal(result.outcome, "red");
  assert.deepEqual(result.reverted, [{ file: "guard.mjs", atBase: "present" }]);
  assert.ok(bytes(root, "guard.mjs").equals(before));
  const added = await main([
    "revert",
    "--root",
    root,
    "--base",
    "HEAD~1",
    "--file",
    "lib/helper.mjs",
    "--command",
    "node absent.mjs lib/helper.mjs",
  ]);
  assert.equal(added.exitCode, 0, "a file the fix added is absent during the run");
  assert.deepEqual(added.reverted, [{ file: "lib/helper.mjs", atBase: "absent" }]);
  assert.equal(bytes(root, "lib/helper.mjs").toString(), "export const helper = 1;\n");
});

test("a search that does not match writes nothing and runs nothing", async (t) => {
  const repo = fixtureRepo(t);
  const { root } = await scratch(t, repo);
  const before = bytes(root, "guard.mjs");
  await assert.rejects(
    main(["edit", "--root", root, "--file", "guard.mjs", "--search", "n >= 99", "--replace", "x", "--command", "node touch.mjs"]),
    /not found/,
  );
  assert.ok(bytes(root, "guard.mjs").equals(before));
  assert.equal(existsSync(path.join(root, "ran.txt")), false);
  await assert.rejects(
    main(["edit", "--root", root, "--file", "../outside.mjs", "--search", "a", "--replace", "b", "--command", "node touch.mjs"]),
    /inside the worktree/,
  );
});

test("it refuses to touch a checkout that is not a scratch worktree", async (t) => {
  const repo = fixtureRepo(t);
  const before = bytes(repo, "guard.mjs");
  await assert.rejects(
    main(["edit", "--root", repo, "--file", "guard.mjs", "--search", "n >= 0", "--replace", "n > 0", "--command", "node touch.mjs"]),
    (error) => error instanceof MutateError && /scratch worktree/.test(error.message),
  );
  assert.ok(bytes(repo, "guard.mjs").equals(before));
  await assert.rejects(main(["teardown", "--root", repo]), /scratch worktree/);
  assert.ok(existsSync(path.join(repo, "guard.mjs")));
});

test("it refuses a linked worktree that setup did not make", async (t) => {
  const repo = fixtureRepo(t);
  // The fixture's own cleanup removes the repository, and with it the worktree's registration.
  const parent = tempDir(t, "linked-");
  const linked = path.join(parent, "work");
  git(repo, "worktree", "add", "--detach", linked, "HEAD");
  const before = bytes(linked, "guard.mjs");
  for (const command of [
    ["edit", "--root", linked, "--file", "guard.mjs", "--search", "n >= 0", "--replace", "n > 0", "--command", "node touch.mjs"],
    ["revert", "--root", linked, "--base", "HEAD~1", "--file", "guard.mjs", "--command", "node touch.mjs"],
    ["run", "--root", linked, "--command", "node touch.mjs"],
  ]) {
    await assert.rejects(main(command), /scratch worktree setup made/);
  }
  assert.ok(bytes(linked, "guard.mjs").equals(before));
  assert.equal(existsSync(path.join(linked, "ran.txt")), false);
});

test("it refuses a worktree beside a manifest setup did not write for it", async (t) => {
  const repo = fixtureRepo(t);
  // A manifest naming the worktree, in a folder setup would not have made; then a scratch-named
  // folder whose manifest names another root.
  for (const [prefix, named] of [
    ["forged-", "work"],
    ["test-prover-", "tree"],
  ]) {
    const parent = tempDir(t, prefix);
    const linked = path.join(parent, "work");
    git(repo, "worktree", "add", "--detach", linked, "HEAD");
    const manifest = { repo, root: path.join(parent, named), head: "HEAD", links: [] };
    writeFileSync(path.join(parent, "test-prover.json"), `${JSON.stringify(manifest)}\n`);
    await assert.rejects(main(["run", "--root", linked, "--command", "node touch.mjs"]), /scratch worktree setup made/);
    await assert.rejects(main(["teardown", "--root", linked]), /scratch worktree setup made/);
    assert.equal(existsSync(path.join(linked, "ran.txt")), false);
    assert.ok(existsSync(path.join(linked, "guard.mjs")), `${prefix} worktree is still there`);
  }
});

test("it refuses a checkout's main worktree, even beside a manifest naming it", async (t) => {
  const parent = tempDir(t, "test-prover-");
  const checkout = path.join(parent, "tree");
  mkdirSync(checkout);
  git(checkout, "init", "-q", "-b", "main");
  writeFileSync(path.join(checkout, "touch.mjs"), 'import { writeFileSync } from "node:fs";\nwriteFileSync("ran.txt", "x");\n');
  git(checkout, "add", "-A");
  git(checkout, "commit", "-q", "-m", "base");
  const manifest = { repo: checkout, root: checkout, head: "HEAD", links: [] };
  writeFileSync(path.join(parent, "test-prover.json"), `${JSON.stringify(manifest)}\n`);
  await assert.rejects(main(["run", "--root", checkout, "--command", "node touch.mjs"]), /main worktree/);
  assert.equal(existsSync(path.join(checkout, "ran.txt")), false);
});

test("a path that leaves the worktree through a link of its own is refused", async (t) => {
  const repo = fixtureRepo(t);
  const outside = tempDir(t, "outside-");
  writeFileSync(path.join(outside, "target.mjs"), "export const a = 1;\n");
  const { root } = await scratch(t, repo);
  const escape = path.join(root, "escape");
  symlinkSync(outside, escape, process.platform === "win32" ? "junction" : "dir");
  try {
    await assert.rejects(
      main(["edit", "--root", root, "--file", "escape/target.mjs", "--search", "1", "--replace", "2", "--command", "node touch.mjs"]),
      /resolves outside the worktree/,
    );
  } finally {
    // Unlinked before teardown removes the tree, so nothing follows the link.
    if (process.platform === "win32") rmdirSync(escape);
    else unlinkSync(escape);
  }
  assert.equal(existsSync(path.join(root, "ran.txt")), false);
  assert.equal(readFileSync(path.join(outside, "target.mjs"), "utf8"), "export const a = 1;\n");
});

test("an error raised during the run still puts the files back, and is the error reported", async (t) => {
  const repo = fixtureRepo(t);
  const { root } = await scratch(t, repo);
  const before = readFileSync(path.join(root, "guard.mjs"));
  // The edit is written first; the run then refuses a --cwd outside the worktree.
  await assert.rejects(
    main(["edit", "--root", root, "--file", "guard.mjs", "--search", "n < 10", "--replace", "n < 11", "--cwd", "..", "--command", "node touch.mjs"]),
    (error) => !/restore failed/.test(error.message),
  );
  assert.deepEqual(readFileSync(path.join(root, "guard.mjs")), before);
});

test("putBack reads each file back and names one whose bytes still differ", (t) => {
  const dir = tempDir(t, "put-back-");
  const file = path.join(dir, "kept.mjs");
  const added = path.join(dir, "added.mjs");
  writeFileSync(file, "original\n");
  const originals = [snapshot(file), snapshot(added)];
  writeFileSync(file, "mutated\n");
  writeFileSync(added, "added for the run\n");
  assert.deepEqual(putBack(originals), []);
  assert.equal(readFileSync(file, "utf8"), "original\n");
  assert.equal(existsSync(added), false);
  writeFileSync(file, "mutated\n");
  const dropsAByte = (target, content) => writeFileSync(target, content.subarray(1));
  assert.deepEqual(putBack(originals, dropsAByte), [file]);
});

test("a path through a linked dependency folder is refused, so the checkout's copy is never written", async (t) => {
  const repo = fixtureRepo(t);
  mkdirSync(path.join(repo, "node_modules", "dep"), { recursive: true });
  writeFileSync(path.join(repo, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n");
  git(repo, "add", ".gitignore");
  git(repo, "commit", "-q", "-m", "ignore");
  const made = await main(["setup", "--repo", repo, "--link", "node_modules"]);
  t.after(() => main(["teardown", "--root", made.root]).catch(() => {}));
  await assert.rejects(
    main(["edit", "--root", made.root, "--file", "node_modules/dep/index.js", "--search", "1", "--replace", "2", "--command", "node touch.mjs"]),
    /linked folder/,
  );
  await assert.rejects(
    main(["revert", "--root", made.root, "--base", "HEAD", "--file", "node_modules/dep/index.js", "--command", "node touch.mjs"]),
    /linked folder/,
  );
  assert.equal(readFileSync(path.join(repo, "node_modules", "dep", "index.js"), "utf8"), "module.exports = 1;\n");
});

test("the helper never runs git checkout, restore, stash, reset or clean", () => {
  const source = readFileSync(helperPath, "utf8");
  for (const word of ["checkout", "restore", "stash", "reset", "clean"]) {
    assert.ok(!new RegExp(`["'\`]${word}["'\`]`).test(source), `mutate.mjs passes "${word}" to git`);
  }
});
