import assert from "node:assert/strict";
import test from "node:test";

import {
  DependabotError,
  classify,
  describeBranch,
  furthestKind,
  parseArgs,
  parseUpdates,
  readVerdict,
  verdictCurrent,
  runCommand,
  summarizeChecks,
} from "../skills/dependabot/dependabot.mjs";

const REPO = "acme/widgets";
const HEAD = "a".repeat(40);
const NEW_HEAD = "b".repeat(40);
const BOT = { login: "dependabot[bot]", type: "Bot" };
const PERSON = { login: "someone", type: "User" };

// Bodies as Dependabot writes them, cut to the lines that name versions.
const GROUPED = [
  "Bumps the npm-minor-patch group with 2 updates in the /web directory: [@playwright/test](https://github.com/microsoft/playwright) and [oxlint](https://github.com/oxc-project/oxc).",
  "",
  "Updates `@playwright/test` from 1.65.0 to 1.65.1",
  "- [Release notes](https://github.com/microsoft/playwright/releases)",
  "",
  "Updates `oxlint` from 1.93.0 to 1.94.0",
].join("\r\n");
const SINGLE = "Bumps [jsdom](https://github.com/jsdom/jsdom) from 30.1.3 to 31.0.0.\n- [Release notes](https://github.com/jsdom/jsdom/releases)";
const DIGEST = "> [!WARNING]\n> Cooldown could not be applied.\n\nBumps dotnet/sdk from `fe0fd4e` to `bef136a`.";
const NUGET = "Updated [Scalar.AspNetCore](https://github.com/scalar/scalar) from 3.0.0 to 3.1.1.\n\n<details>";
const TOGETHER = [
  "Removes [decode-uri-component](https://github.com/x/y). It's no longer used after updating ancestor dependency [expo-router](https://github.com/expo/expo).",
  "Removes `decode-uri-component`",
  "",
  "Updates `expo-router` from 57.0.29 to 58.0.28",
].join("\n");
const IMAGE_GROUP = "Bumps the docker-minor-and-patch group with 1 update in the /backend/api-service directory: golang.\n\nUpdates `golang` from 1.27.3-alpine to 1.27.4-alpine";
const PINNED_NUGET = [
  "Pinned [Azure.Storage.Blobs](https://github.com/Azure/azure-sdk-for-net) at 12.30.2.",
  "Updated [Npgsql.EntityFrameworkCore.PostgreSQL](https://github.com/npgsql/efcore.pg) from 10.0.3 to 10.0.4.",
  "Updated [Npgsql.OpenTelemetry](https://github.com/npgsql/npgsql) from 10.0.3 to 10.0.4.",
  "Updated [Scalar.AspNetCore](https://github.com/scalar/scalar) from 3.1.1 to 3.2.0.",
].join("\n");

test("parseArgs reads list and refuses what does not fit it", () => {
  assert.deepEqual(parseArgs(["list", "--repo", REPO]), { command: "list", repo: REPO, pr: null, label: "widgets", wait: 0 });
  assert.equal(parseArgs(["list", "--repo", REPO, "--pr", "7", "--label", "Widgets", "--wait", "60"]).label, "Widgets");
  assert.throws(() => parseArgs(["merge", "--repo", REPO]), DependabotError);
  assert.throws(() => parseArgs(["list"]), /--repo is required/);
  assert.throws(() => parseArgs(["list", "--repo", "widgets"]), /owner\/name/);
  assert.throws(() => parseArgs(["list", "--repo", REPO, "--wait", "60"]), /--wait needs --pr/);
  assert.throws(() => parseArgs(["list", "--repo", REPO, "--pr", "0"]), /pull request number/);
});

test("each body shape gives its dependencies with from, to and kind", () => {
  assert.deepEqual(parseUpdates("Bump the npm-minor-patch group across 1 directory with 2 updates", GROUPED), [
    { name: "@playwright/test", from: "1.65.0", to: "1.65.1", kind: "patch" },
    { name: "oxlint", from: "1.93.0", to: "1.94.0", kind: "minor" },
  ]);
  assert.deepEqual(parseUpdates("Bump jsdom from 30.1.3 to 31.0.0", SINGLE), [{ name: "jsdom", from: "30.1.3", to: "31.0.0", kind: "major" }]);
  assert.deepEqual(parseUpdates("Bump dotnet/sdk", DIGEST), [{ name: "dotnet/sdk", from: "fe0fd4e", to: "bef136a", kind: "digest" }]);
  assert.deepEqual(parseUpdates("Bump the nuget-minor-patch group with 1 update", NUGET), [
    { name: "Scalar.AspNetCore", from: "3.0.0", to: "3.1.1", kind: "minor" },
  ]);
  assert.deepEqual(parseUpdates("Bump decode-uri-component and expo-router", TOGETHER), [
    { name: "decode-uri-component", from: null, to: null, kind: "removed" },
    { name: "expo-router", from: "57.0.29", to: "58.0.28", kind: "major" },
  ]);
  assert.deepEqual(parseUpdates("bump golang", IMAGE_GROUP), [{ name: "golang", from: "1.27.3-alpine", to: "1.27.4-alpine", kind: "patch" }]);
});

test("a body a person replaced falls back to the title, or reports nothing parsed", () => {
  const edited = "# Summary\nBumps the `npm-minor-and-patch` group: `@tanstack/react-query` 5.105.3 → 5.106.1";
  assert.deepEqual(parseUpdates("chore: bump vite from 8.3.7 to 8.3.8 in /web", edited), [{ name: "vite", from: "8.3.7", to: "8.3.8", kind: "patch" }]);
  assert.deepEqual(parseUpdates("chore: bump the npm-minor-and-patch group in /frontend with 6 updates", edited), []);
  assert.equal(furthestKind([]), "unknown");
});

test("pinned NuGet updates retain their target version with an unknown change kind", () => {
  assert.deepEqual(parseUpdates("chore: Bump Azure.Storage.Blobs and 3 others", PINNED_NUGET), [
    { name: "Azure.Storage.Blobs", from: null, to: "12.30.2", kind: "unknown" },
    { name: "Npgsql.EntityFrameworkCore.PostgreSQL", from: "10.0.3", to: "10.0.4", kind: "patch" },
    { name: "Npgsql.OpenTelemetry", from: "10.0.3", to: "10.0.4", kind: "patch" },
    { name: "Scalar.AspNetCore", from: "3.1.1", to: "3.2.0", kind: "minor" },
  ]);
  assert.deepEqual(parseUpdates("Bump Azure.Storage.Blobs", "Pinned Azure.Storage.Blobs at `13.0.0`."), [
    { name: "Azure.Storage.Blobs", from: null, to: "13.0.0", kind: "unknown" },
  ]);
});

test("a verdict must name a pinned update's current target version", () => {
  const title = "chore: Bump Azure.Storage.Blobs and 3 others";
  const comments = [{
    user: PERSON,
    body: "✅ Azure.Storage.Blobs 12.30.2, Npgsql packages 10.0.4 and Scalar.AspNetCore 3.2.0 reviewed\n\nDependabot PR review by the Widgets routine",
  }];
  assert.equal(readVerdict(comments, parseUpdates(title, PINNED_NUGET)).verdict.versionsNamed, true);
  const retargeted = parseUpdates(title, PINNED_NUGET.replace("12.30.2", "13.0.0"));
  assert.equal(readVerdict(comments, retargeted).verdict.versionsNamed, false);
});

test("versions are classified by the first segment that moves", () => {
  assert.equal(classify("4", "6"), "major");
  assert.equal(classify("v3.2.0", "v4.0.0"), "major");
  assert.equal(classify("10.0", "11.0"), "major");
  assert.equal(classify("0.162.7", "0.163.1"), "minor");
  assert.equal(classify("3.13-slim", "3.15-slim"), "minor");
  assert.equal(classify("5.20261107.1", "5.20261109.1"), "minor");
  assert.equal(classify("1.2.3", "1.2.4"), "patch");
  assert.equal(classify("2.1.0", "2.0.9"), "downgrade");
  assert.equal(classify("18.6-alpine3.24", "18.6-alpine3.25"), "suffix");
  assert.equal(classify("18.6-alpine3.24", "18.6-alpine3.24"), "digest");
  assert.equal(classify("latest", "stable"), "unknown");
  assert.equal(furthestKind([{ kind: "patch" }, { kind: "major" }, { kind: "minor" }]), "major");
  assert.equal(furthestKind([{ kind: "removed" }, { kind: "digest" }]), "digest");
});

test("the branch name and body give the ecosystem, directory and group", () => {
  assert.deepEqual(describeBranch("dependabot/npm_and_yarn/web/npm-minor-patch-d3df75cf93", "Bump the group", GROUPED), {
    ecosystem: "npm_and_yarn",
    directory: "/web",
    group: "npm-minor-patch",
  });
  assert.deepEqual(describeBranch("dependabot/docker/dotnet/sdk-bef136a", "Bump dotnet/sdk", DIGEST), { ecosystem: "docker", directory: "/", group: null });
  assert.deepEqual(
    describeBranch("dependabot/npm_and_yarn/frontend/jsdom-31.0.0", "chore: bump jsdom from 30.1.3 to 31.0.0 in /frontend", SINGLE),
    { ecosystem: "npm_and_yarn", directory: "/frontend", group: null },
  );
  assert.equal(describeBranch("feature/x", "", "").ecosystem, null);
});

test("checks: a failure outranks pending, cancelled is apart, and nothing reported yet is pending", () => {
  const runs = [
    { name: "build", status: "completed", conclusion: "success", html_url: "https://github.com/acme/widgets/actions/runs/11/job/22" },
    { id: 56, name: "test", status: "completed", conclusion: "failure", html_url: "https://github.com/acme/widgets/actions/runs/12/job/34" },
    { name: "guard", status: "completed", conclusion: "cancelled", html_url: null },
    { name: "e2e", status: "in_progress", conclusion: null, html_url: null },
  ];
  const checks = summarizeChecks(runs, { statuses: [{ context: "Workers Builds", state: "success", target_url: null }] });
  assert.equal(checks.state, "failed");
  assert.deepEqual(checks.failed, [
    { name: "test", url: "https://github.com/acme/widgets/actions/runs/12/job/34", conclusion: "failure", checkRunId: 56, runId: 12, jobId: 34 },
  ]);
  assert.deepEqual(checks.cancelled.map((check) => check.name), ["guard"]);
  assert.deepEqual(checks.pending.map((check) => check.name), ["e2e"]);
  assert.equal(checks.passed, 2);
  assert.equal(summarizeChecks(runs.slice(2), { statuses: [] }).state, "pending");
  assert.equal(summarizeChecks([], { statuses: [] }).state, "pending");
  assert.equal(summarizeChecks([runs[0]], { statuses: [{ context: "deploy", state: "error" }] }).state, "failed");
  assert.equal(summarizeChecks([runs[0], runs[2]], { statuses: [] }).state, "passed");
});

test("the latest marked comment is the verdict, and it counts for the versions it names", () => {
  const updates = [
    { name: "jsdom", from: "30.1.3", to: "31.0.0", kind: "major" },
    { name: "dotnet/sdk", from: "fe0fd4e", to: "bef136abcdef", kind: "digest" },
  ];
  const marker = "\n\n\u{1F916} Dependabot PR review by the Widgets routine";
  const comments = [
    { user: PERSON, body: `⚠️ **NEEDS EFFORT** jsdom 31.0.0 breaks${marker}`, created_at: "2026-11-01T00:00:00Z", html_url: "u1" },
    { user: PERSON, body: "hold this until the release", created_at: "2026-11-02T00:00:00Z" },
    { user: BOT, body: "Dependabot will resolve any conflicts", created_at: "2026-11-02T00:00:00Z" },
    { user: PERSON, body: `✅ **VERIFIED LOW-RISK** jsdom 31.0.0 and \`bef136a\` reviewed${marker}`, created_at: "2026-11-03T00:00:00Z", html_url: "u2" },
  ];
  const { verdict, comments: others } = readVerdict(comments, updates);
  assert.deepEqual(verdict, { kind: "low-risk", label: "Widgets", url: "u2", createdAt: "2026-11-03T00:00:00Z", versionsNamed: true });
  assert.deepEqual(others.map((comment) => comment.body), ["hold this until the release"]);
  assert.equal(readVerdict(comments.slice(0, 1), updates).verdict.kind, "needs-effort");
  assert.equal(readVerdict(comments.slice(0, 1), updates).verdict.versionsNamed, false);
  const retargeted = [{ name: "jsdom", from: "30.1.3", to: "31.0.1", kind: "major" }];
  assert.equal(readVerdict(comments, retargeted).verdict.versionsNamed, false);
  assert.equal(readVerdict([], updates).verdict, null);
});

test("a low-risk verdict stays current only while it names the versions and the checks have not failed", () => {
  const lowRisk = { kind: "low-risk", versionsNamed: true };
  assert.equal(verdictCurrent(lowRisk, { state: "passed" }), true);
  assert.equal(verdictCurrent(lowRisk, { state: "pending" }), true);
  assert.equal(verdictCurrent(lowRisk, { state: "failed" }), false);
  assert.equal(verdictCurrent({ ...lowRisk, versionsNamed: false }, { state: "passed" }), false);
  assert.equal(verdictCurrent({ kind: "needs-effort", versionsNamed: false }, { state: "failed" }), true);
  assert.equal(verdictCurrent({ kind: "needs-effort", versionsNamed: true }, { state: "passed" }), true);
  assert.equal(verdictCurrent(null, { state: "failed" }), false);
});

function pull(number, overrides = {}) {
  return {
    number,
    title: `Bump jsdom from 30.1.3 to 31.0.${number}`,
    body: `Bumps [jsdom](https://github.com/jsdom/jsdom) from 30.1.3 to 31.0.${number}.`,
    html_url: `https://github.com/${REPO}/pull/${number}`,
    user: BOT,
    state: "open",
    draft: false,
    labels: [{ name: "dependencies" }],
    created_at: `2026-11-0${number}T00:00:00Z`,
    head: { sha: HEAD, ref: `dependabot/npm_and_yarn/jsdom-31.0.${number}` },
    mergeable: true,
    mergeable_state: "clean",
    merged_at: null,
    ...overrides,
  };
}

function fakeRepo({ pulls, checkRuns = {}, commits = {}, comments = {} }) {
  const calls = [];
  const rest = (endpoint) => {
    calls.push(endpoint);
    if (endpoint === `repos/${REPO}/pulls?state=open&per_page=100`) return pulls.map(({ mergeable_state: _omit, ...listed }) => listed);
    let match = endpoint.match(/^repos\/acme\/widgets\/pulls\/(\d+)$/);
    if (match) return pulls.find((pr) => pr.number === Number(match[1]));
    match = endpoint.match(/^repos\/acme\/widgets\/commits\/(\w+)\/check-runs/);
    if (match) {
      const value = checkRuns[match[1]];
      return { check_runs: typeof value === "function" ? value() : (value ?? []) };
    }
    if (/\/commits\/\w+\/status$/.test(endpoint)) return { statuses: [] };
    match = endpoint.match(/pulls\/(\d+)\/commits/);
    if (match) return commits[match[1]] ?? [{ sha: HEAD, author: BOT }];
    match = endpoint.match(/issues\/(\d+)\/comments/);
    if (match) return comments[match[1]] ?? [];
    throw new Error(`unexpected endpoint ${endpoint}`);
  };
  return { rest, calls };
}

test("list gives only Dependabot's open PRs, oldest first, each read on its current head", () => {
  const passed = [{ name: "build", status: "completed", conclusion: "success", html_url: null }];
  const repo = fakeRepo({
    pulls: [pull(3), pull(1, { head: { sha: NEW_HEAD, ref: "dependabot/npm_and_yarn/jsdom-31.0.1" } }), pull(2, { user: PERSON })],
    checkRuns: { [HEAD]: passed, [NEW_HEAD]: [] },
    commits: { 3: [{ sha: HEAD, author: BOT }, { sha: NEW_HEAD, author: PERSON }] },
  });
  const result = runCommand(["list", "--repo", REPO, "--label", "Widgets"], { rest: repo.rest });
  assert.equal(result.marker, "\u{1F916} Dependabot PR review by the Widgets routine");
  assert.deepEqual(result.prs.map((pr) => pr.number), [1, 3]);
  const [first, second] = result.prs;
  assert.equal(first.headSha, NEW_HEAD);
  assert.equal(first.checks.state, "pending");
  assert.equal(first.kind, "major");
  assert.equal(first.mergeableState, "clean");
  assert.equal(first.maintainedByDependabot, true);
  assert.equal(second.checks.state, "passed");
  assert.equal(second.maintainedByDependabot, false);
  assert.deepEqual(second.othersCommitted, [NEW_HEAD]);
  assert.ok(repo.calls.includes(`repos/${REPO}/commits/${NEW_HEAD}/check-runs?per_page=100`));
});

test("list treats a pinned major as a candidate even when the other updates are routine", () => {
  const repo = fakeRepo({ pulls: [pull(1, {
    title: "chore: Bump Azure.Storage.Blobs and 3 others",
    body: PINNED_NUGET.replace("12.30.2", "13.0.0"),
  })] });
  const [pr] = runCommand(["list", "--repo", REPO], { rest: repo.rest }).prs;
  assert.equal(pr.updates.length, 4);
  assert.equal(pr.parsed, true);
  assert.equal(pr.kind, "unknown");
});

test("list flags fewer updates than a group title names and invalidates a low-risk verdict", () => {
  for (const title of [
    "chore: Bump Scalar.AspNetCore and 3 others",
    "Bump Scalar.AspNetCore and 1 other",
    "Bump the nuget-minor-patch group with 4 updates",
  ]) {
    const repo = fakeRepo({
      pulls: [pull(1, { title, body: NUGET })],
      comments: { 1: [{ user: PERSON, body: "✅ Scalar.AspNetCore 3.1.1 reviewed\n\nDependabot PR review by the Widgets routine" }] },
    });
    const [pr] = runCommand(["list", "--repo", REPO], { rest: repo.rest }).prs;
    assert.equal(pr.updates.length, 1, title);
    assert.equal(pr.parsed, false, title);
    assert.equal(pr.kind, "unknown", title);
    assert.equal(pr.verdict.current, false, title);
  }
});

test("list keeps complete grouped updates parsed", () => {
  for (const title of [
    "chore: Bump @playwright/test and 1 other",
    "Bump the npm-minor-patch group with 2 updates",
    "Bump the npm-minor-patch group",
  ]) {
    const repo = fakeRepo({ pulls: [pull(1, { title, body: GROUPED })] });
    const [pr] = runCommand(["list", "--repo", REPO], { rest: repo.rest }).prs;
    assert.equal(pr.parsed, true, title);
    assert.equal(pr.kind, "minor", title);
  }
});

test("a mergeable state GitHub has not computed yet is read again, a few times", () => {
  const repo = fakeRepo({ pulls: [pull(1)], checkRuns: { [HEAD]: [] } });
  let reads = 0;
  const lazy = (endpoint) => {
    if (endpoint !== `repos/${REPO}/pulls/1`) return repo.rest(endpoint);
    reads += 1;
    return pull(1, reads < 3 ? { mergeable: null, mergeable_state: "unknown" } : { mergeable_state: "behind" });
  };
  const pauses = [];
  const result = runCommand(["list", "--repo", REPO, "--pr", "1"], { rest: lazy, sleep: (ms) => pauses.push(ms) });
  assert.equal(result.prs[0].mergeableState, "behind");
  assert.equal(reads, 3);

  reads = -100;
  const never = runCommand(["list", "--repo", REPO, "--pr", "1"], { rest: lazy, sleep: () => {} });
  assert.equal(never.prs[0].mergeableState, "unknown");
  assert.equal(reads, -96);
});

test("waiting on one PR polls until its checks finish, and stops at the deadline", () => {
  let reads = 0;
  const repo = fakeRepo({
    pulls: [pull(1)],
    checkRuns: {
      [HEAD]: () => {
        reads += 1;
        return [{ name: "build", status: reads < 3 ? "in_progress" : "completed", conclusion: reads < 3 ? null : "success" }];
      },
    },
  });
  let clock = 0;
  const options = { rest: repo.rest, sleep: (ms) => (clock += ms), now: () => clock };
  const done = runCommand(["list", "--repo", REPO, "--pr", "1", "--wait", "300"], options);
  assert.equal(done.prs[0].checks.state, "passed");
  assert.equal(done.timedOut, false);
  assert.equal(done.waitedSeconds, 40);

  reads = -100;
  clock = 0;
  const late = runCommand(["list", "--repo", REPO, "--pr", "1", "--wait", "30"], options);
  assert.equal(late.prs[0].checks.state, "pending");
  assert.equal(late.timedOut, true);
});

test("a retryable failure is retried twice, and any other failure ends the call", () => {
  const repo = fakeRepo({ pulls: [pull(1)], checkRuns: { [HEAD]: [] } });
  let failures = 1;
  const flaky = (endpoint) => {
    if (endpoint.includes("check-runs") && failures > 0) {
      failures -= 1;
      const error = new DependabotError("HTTP 502");
      error.retryable = true;
      throw error;
    }
    return repo.rest(endpoint);
  };
  let clock = 0;
  const result = runCommand(["list", "--repo", REPO, "--pr", "1", "--wait", "120"], { rest: flaky, sleep: (ms) => (clock += ms), now: () => clock });
  assert.equal(result.recoveredFrom, "HTTP 502");

  const broken = () => {
    throw new DependabotError("Not Found");
  };
  assert.throws(() => runCommand(["list", "--repo", REPO], { rest: broken }), /Not Found/);
});
