import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  OWN_SOURCE,
  checkConsumers,
  compareConsumer,
  fetchConsumer,
  parseInstallCommands,
  renderMarkdown,
  upstreamState,
  versionDate,
} from "./consumer-drift.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const BLOCK = [
  "```bash",
  "npx skills add jwh3times/skills -s ship -s handoff -a codex --copy -y",
  "npx skills add someone/skills#abc123 \\",
  "  -s tdd -s grilling \\",
  "  -a codex --copy -y",
  "node scripts/sync-agents.mjs",
  "```",
].join("\r\n");

const upstream = {
  head: "f00ba47",
  skills: { ship: "tree-ship", handoff: "tree-handoff" },
  scripts: {
    "check-skills.mjs": "blob-cs",
    "check-skills.test.mjs": "blob-cst",
    "stamp-changelog.mjs": "blob-sc",
    "stamp-changelog.test.mjs": "blob-sct",
  },
  snapshots: [{ source: "someone/skills", ref: "abc123", skills: ["tdd", "grilling"] }],
};

const currentConsumer = () => ({
  skills: { ship: "tree-ship", handoff: "tree-handoff", local: "tree-own" },
  scripts: { "check-skills.mjs": "blob-cs", "check-skills.test.mjs": "blob-cst", "other.mjs": "x" },
  lock: {
    skills: {
      tdd: { source: "someone/skills", ref: "abc123" },
      grilling: { source: "someone/skills", ref: "abc123" },
      ship: { source: OWN_SOURCE, commit: "an-older-commit" },
    },
  },
});

test("install commands are parsed across continuations and CRLF", () => {
  const [own, snapshot] = parseInstallCommands(BLOCK);
  assert.deepEqual(own, {
    source: OWN_SOURCE,
    ref: null,
    skills: ["ship", "handoff"],
    args: ["skills", "add", OWN_SOURCE, "-s", "ship", "-s", "handoff", "-a", "codex", "--copy", "-y"],
  });
  assert.equal(snapshot.source, "someone/skills");
  assert.equal(snapshot.ref, "abc123");
  assert.deepEqual(snapshot.skills, ["tdd", "grilling"]);
  assert.equal(snapshot.args.at(-1), "-y");
});

test("the shared block here names this repository's skills and a pinned snapshot", () => {
  const state = upstreamState(repoRoot);
  assert.ok(state.skills["open-pr"], "open-pr has a tree id");
  assert.equal(state.skills.ship, undefined, "the retired ship is not listed");
  assert.ok(Object.values(state.skills).every(Boolean), "every listed skill exists under skills/");
  assert.ok(state.scripts["check-skills.mjs"]);
  assert.ok(state.snapshots.length > 0 && state.snapshots.every((s) => s.ref));
});

test("a consumer matching every id is current, whatever its lock commit says", () => {
  assert.deepEqual(compareConsumer(upstream, currentConsumer()), []);
});

test("a skill or script with another id is stale, and its id is kept", () => {
  const consumer = currentConsumer();
  consumer.skills.ship = "tree-old";
  consumer.scripts["check-skills.test.mjs"] = "blob-old";
  assert.deepEqual(compareConsumer(upstream, consumer), [
    { kind: "skill", name: "ship", state: "stale", have: "tree-old" },
    { kind: "script", name: "check-skills.test.mjs", state: "stale", have: "blob-old" },
  ]);
});

test("a missing skill or always-carried script is reported; an absent optional script is not", () => {
  const consumer = currentConsumer();
  delete consumer.skills.handoff;
  delete consumer.scripts["check-skills.mjs"];
  assert.deepEqual(compareConsumer(upstream, consumer), [
    { kind: "skill", name: "handoff", state: "missing" },
    { kind: "script", name: "check-skills.mjs", state: "missing" },
  ]);
});

test("the guard is always carried, so a consumer without it is behind", () => {
  const withGuard = {
    ...upstream,
    scripts: { ...upstream.scripts, "guard.mjs": "blob-g", "guard.test.mjs": "blob-gt" },
  };
  assert.deepEqual(compareConsumer(withGuard, currentConsumer()), [
    { kind: "script", name: "guard.mjs", state: "missing" },
    { kind: "script", name: "guard.test.mjs", state: "missing" },
  ]);
});

test("a carried optional script is compared", () => {
  const consumer = currentConsumer();
  consumer.scripts["stamp-changelog.mjs"] = "blob-old";
  consumer.scripts["stamp-changelog.test.mjs"] = "blob-sct";
  assert.deepEqual(compareConsumer(upstream, consumer), [
    { kind: "script", name: "stamp-changelog.mjs", state: "stale", have: "blob-old" },
  ]);
});

test("a lock off the pinned snapshot, or no lock, is one snapshot item", () => {
  const consumer = currentConsumer();
  consumer.lock.skills.tdd.ref = "older";
  assert.deepEqual(compareConsumer(upstream, consumer), [
    { kind: "snapshot", name: "someone/skills", state: "stale", count: 1 },
  ]);
  consumer.lock = null;
  assert.deepEqual(compareConsumer(upstream, consumer), [
    { kind: "snapshot", name: "someone/skills", state: "stale", count: 2 },
  ]);
});

function fakeFetch(routes, seen = []) {
  return async (url, { headers }) => {
    seen.push({ url, headers });
    const rel = new URL(url).pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, "");
    const body = routes[rel];
    if (body === undefined) return { status: 404, ok: false };
    if (typeof body === "number") return { status: body, ok: false };
    return {
      status: 200,
      ok: true,
      json: async () => body,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
  };
}

test("fetchConsumer keeps folder trees, file blobs and the raw lock from main", async () => {
  const seen = [];
  const fetchImpl = fakeFetch(
    {
      ".agents/skills": [
        { name: "ship", type: "dir", sha: "t1" },
        { name: "README.md", type: "file", sha: "b0" },
      ],
      scripts: [
        { name: "check-skills.mjs", type: "file", sha: "b1" },
        { name: "lib", type: "dir", sha: "t2" },
      ],
      "skills-lock.json": '{"version":2,"skills":{}}',
    },
    seen,
  );
  const consumer = await fetchConsumer("o/r", { token: "tok", fetchImpl });
  assert.deepEqual(consumer, {
    skills: { ship: "t1" },
    scripts: { "check-skills.mjs": "b1" },
    lock: { version: 2, skills: {} },
  });
  assert.ok(seen.every(({ url }) => url.endsWith("?ref=main")));
  assert.ok(seen.every(({ headers }) => headers.Authorization === "Bearer tok"));
  assert.match(seen.find(({ url }) => url.includes("skills-lock.json")).headers.Accept, /raw/);
});

test("fetchConsumer treats a 404 as absent and any other failure as an error", async () => {
  const empty = await fetchConsumer("o/r", { fetchImpl: fakeFetch({}) });
  assert.deepEqual(empty, { skills: {}, scripts: {}, lock: null });
  await assert.rejects(fetchConsumer("o/r", { fetchImpl: fakeFetch({ scripts: 403 }) }), /HTTP 403/);
});

test("checkConsumers reports each consumer, keeps going past a failure, and lists sync targets", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "consumer-drift-"));
  try {
    mkdirSync(path.join(root, "settings"));
    writeFileSync(path.join(root, "settings", "agents-md.md"), BLOCK);
    writeFileSync(
      path.join(root, "consumers.json"),
      JSON.stringify({ consumers: [{ repo: "o/behind", sync: true }, { repo: "o/broken" }, { repo: "o/manual" }] }),
    );
    const git = (_root, args) => {
      if (args[1] === "HEAD") return "f00ba47";
      const rel = args[1].slice("HEAD:".length);
      return { "skills/ship": "tree-ship", "skills/handoff": "tree-handoff" }[rel] ?? null;
    };
    const fetchImpl = async (url, options) => {
      if (url.includes("/o/broken/")) return { status: 500, ok: false };
      return fakeFetch({ ".agents/skills": [{ name: "ship", type: "dir", sha: "tree-ship" }] })(url, options);
    };
    const report = await checkConsumers(root, { fetchImpl, git });
    assert.equal(report.head, "f00ba47");
    assert.deepEqual(
      report.results.map((r) => [r.repo, r.error ? "error" : r.items.map((i) => `${i.name}:${i.state}`).join(" ")]),
      [
        ["o/behind", "handoff:missing someone/skills:stale"],
        ["o/broken", "error"],
        ["o/manual", "handoff:missing someone/skills:stale"],
      ],
    );
    assert.deepEqual(report.syncTargets, [{ repo: "o/behind", name: "behind" }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the report has a row per consumer behind, the failures, and who is current", () => {
  const markdown = renderMarkdown(
    {
      head: "f00ba47cafe",
      results: [
        { repo: "o/a", sync: true, items: [{ kind: "skill", name: "ship", state: "stale", have: "t" }] },
        { repo: "o/b", sync: false, items: [{ kind: "script", name: "check-docs.mjs", state: "missing" }] },
        { repo: "o/c", sync: false, items: [] },
        { repo: "o/d", sync: false, error: "GET o/d/scripts: HTTP 500" },
      ],
    },
    () => "2026-11-12",
  );
  assert.match(markdown, /at f00ba47\./);
  assert.match(markdown, /\| o\/a \| `ship` \(has the 2026-11-12 version\) \| sync PR \|/);
  assert.match(markdown, /\| o\/b \| `check-docs.mjs` \(missing\) \| by hand \|/);
  assert.match(markdown, /- o\/d: GET o\/d\/scripts: HTTP 500/);
  assert.match(markdown, /Current: o\/c\./);
});

test("versionDate finds the upstream commit whose copy a consumer still has", () => {
  const root = mkdtempSync(path.join(tmpdir(), "consumer-drift-git-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "test");
    mkdirSync(path.join(root, "scripts"));
    const commit = (content, date) => {
      writeFileSync(path.join(root, "scripts", "a.mjs"), content);
      git("add", ".");
      execFileSync("git", ["commit", "-q", "-m", content], {
        cwd: root,
        env: { ...process.env, GIT_COMMITTER_DATE: `${date}T12:00:00Z`, GIT_AUTHOR_DATE: `${date}T12:00:00Z` },
      });
      return git("rev-parse", "HEAD:scripts/a.mjs");
    };
    const first = commit("one\n", "2026-10-01");
    commit("two\n", "2026-11-01");
    assert.equal(versionDate(root, "scripts/a.mjs", first), "2026-10-01");
    assert.equal(versionDate(root, "scripts/a.mjs", "0".repeat(40)), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
