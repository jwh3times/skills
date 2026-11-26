import assert from "node:assert/strict";
import test from "node:test";

import {
  DependabotError,
  classify,
  describeBranch,
  expectedUpdates,
  furthestKind,
  manifestReviewMarker,
  parseArgs,
  parseUpdates,
  readUpdates,
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
// A comment by the repository's owner, as GitHub's REST API gives it.
const OWNER = { user: PERSON, author_association: "OWNER" };

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
// jwh3times/apexracers#562: NuGet with transitive pinning writes the pinned package without a `from`.
const PINNED_TITLE = "chore: Bump Azure.Storage.Blobs and 3 others";
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

test("a pinned update keeps its new version, with no old one and an unknown kind", () => {
  assert.deepEqual(parseUpdates(PINNED_TITLE, PINNED_NUGET), [
    { name: "Azure.Storage.Blobs", from: null, to: "12.30.2", kind: "unknown" },
    { name: "Npgsql.EntityFrameworkCore.PostgreSQL", from: "10.0.3", to: "10.0.4", kind: "patch" },
    { name: "Npgsql.OpenTelemetry", from: "10.0.3", to: "10.0.4", kind: "patch" },
    { name: "Scalar.AspNetCore", from: "3.1.1", to: "3.2.0", kind: "minor" },
  ]);
  assert.deepEqual(parseUpdates("Bump Azure.Storage.Blobs", "Pinned Azure.Storage.Blobs at `13.0.0`."), [
    { name: "Azure.Storage.Blobs", from: null, to: "13.0.0", kind: "unknown" },
  ]);
  const pinned = readUpdates(PINNED_TITLE, PINNED_NUGET.replace("12.30.2", "13.0.0"));
  assert.equal(pinned.parsed, true);
  assert.equal(pinned.kind, "unknown", "a pinned major, beside routine updates, makes the PR a candidate");
});

test("the title says how many dependencies a PR updates, and names them when it can", () => {
  const cases = [
    ["Bump the npm-minor-patch group across 1 directory with 2 updates", { count: 2, names: [] }],
    ["Bump the npm group across 2 directories with 3 updates", { count: 3, names: [] }],
    ["chore: bump the npm-minor-and-patch group in /frontend with 1 update", { count: 1, names: [] }],
    [PINNED_TITLE, { count: 4, names: ["Azure.Storage.Blobs"] }],
    ["Bump Scalar.AspNetCore and 1 other", { count: 2, names: ["Scalar.AspNetCore"] }],
    ["Bump lodash and axios in /web", { count: 2, names: ["lodash", "axios"] }],
    ["build(deps): bump a, b and c", { count: 3, names: ["a", "b", "c"] }],
    ["chore: bump vite from 8.3.7 to 8.3.8 in /web", { count: 1, names: ["vite"] }],
    ["bump golang", { count: 1, names: ["golang"] }],
  ];
  for (const [title, expected] of cases) assert.deepEqual(expectedUpdates(title, ""), expected, title);
  assert.deepEqual(expectedUpdates("Bump the npm-minor-patch group", GROUPED), { count: 2, names: [] });
  assert.equal(expectedUpdates("Bump the npm-minor-patch group", "Dependency details were replaced."), null);
  assert.equal(expectedUpdates("Update rails requirement from ~> 7.1 to ~> 8.0", ""), null);
});

test("a PR is parsed only when every dependency its title counts or names was read", () => {
  const complete = readUpdates("Bump the npm-minor-patch group across 1 directory with 2 updates", GROUPED);
  assert.equal(complete.parsed, true);
  assert.equal(complete.kind, "minor", "a fully parsed PR keeps its own kind, so routine PRs stay routine");
  assert.equal(readUpdates("Bump decode-uri-component and expo-router", TOGETHER).parsed, true);
  assert.equal(readUpdates("Bump jsdom from 30.1.3 to 31.0.0", SINGLE).parsed, true);
  assert.equal(readUpdates(PINNED_TITLE, PINNED_NUGET).parsed, true);

  // One dependency from two old versions in two directories counts once, so z's missing line shows.
  const twice = ["Updates `x` from 1.0.0 to 2.0.0", "Updates `x` from 1.1.0 to 2.0.0", "Updates `y` from 1.0.0 to 1.0.1"].join("\n");
  const grouped = readUpdates("Bump the npm group across 2 directories with 3 updates", twice);
  assert.equal(grouped.updates.length, 3);
  assert.equal(grouped.parsed, false);
  assert.equal(grouped.expected, 3);

  // A title that names its dependencies without a count.
  const named = readUpdates("Bump lodash and axios in /web", "Updates `lodash` from 4.17.20 to 4.17.21");
  assert.equal(named.parsed, false);
  assert.deepEqual(named.missing, ["axios"]);
  assert.equal(named.kind, "unknown", "a patch read while an update is missing is not routine");
  // The count adds up only because a removed dependency was read in axios's place.
  const swapped = readUpdates("Bump lodash and axios", "Removes `left-pad`\nUpdates `lodash` from 4.17.20 to 4.17.21");
  assert.equal(swapped.parsed, false);
  assert.deepEqual(swapped.missing, ["axios"]);

  // A major among the updates read is still reported as a major.
  const major = readUpdates("Bump Scalar.AspNetCore and 1 other", "Updated [Scalar.AspNetCore](https://x/y) from 3.1.1 to 4.0.0.");
  assert.equal(major.parsed, false);
  assert.equal(major.kind, "major");
});

test("a grouped body GitHub cut off at 65,536 characters is not parsed", () => {
  const notes = `- ${"release notes ".repeat(3000)}`;
  const full = [
    "Bumps the npm-minor-patch group with 3 updates in the / directory: a, b and c.",
    "Updates `a` from 1.0.0 to 1.0.1",
    notes,
    "Updates `b` from 2.0.0 to 2.1.0",
    notes,
    "Updates `c` from 3.0.0 to 4.0.0",
  ].join("\n");
  const body = full.slice(0, 65_536);
  assert.ok(!body.includes("Updates `c`"));
  for (const title of ["Bump the npm-minor-patch group across 1 directory with 3 updates", "Bump the npm-minor-patch group"]) {
    const read = readUpdates(title, body);
    assert.equal(read.updates.length, 2, title);
    assert.equal(read.expected, 3, title);
    assert.equal(read.parsed, false, title);
    assert.equal(read.kind, "unknown", title);
  }
});

test("the manifest review marker follows the title and the changed lines, not the shas", () => {
  const pr = { number: 1, title: "Bump Scalar.AspNetCore and 1 other" };
  const files = [
    { filename: "Directory.Packages.props", status: "modified", sha: "1".repeat(40), patch: "@@ -10,3 +10,3 @@\n context\n-    <Pkg V=\"3.1.1\" />\n+    <Pkg V=\"3.2.0\" />" },
    { filename: "packages.lock.json", status: "modified", sha: "2".repeat(40) },
  ];
  const marker = manifestReviewMarker(REPO, pr, files);
  assert.match(marker, /^<!-- dependabot-manifest-review: [0-9a-f]{64} -->$/);
  const rebased = [{ ...files[0], sha: "3".repeat(40), patch: files[0].patch.replace("-10,3 +10,3", "-12,3 +12,3").replace("context", "moved") }, files[1]];
  assert.equal(manifestReviewMarker("Acme/Widgets", pr, [...rebased].reverse()), marker, "a rebase keeps it");
  for (const [why, changed, changedFiles] of [
    ["a retarget", pr, [{ ...files[0], patch: files[0].patch.replace("3.2.0", "3.2.1") }, files[1]]],
    ["a new title", { ...pr, title: "Bump Scalar.AspNetCore and 2 others" }, files],
    ["a file with no patch changed", pr, [files[0], { ...files[1], sha: "4".repeat(40) }]],
    ["another PR", { ...pr, number: 2 }, files],
  ]) {
    assert.notEqual(manifestReviewMarker(REPO, changed, changedFiles), marker, why);
  }
});

test("a version found only in the manifest marker's hex is not named", () => {
  const marker = `<!-- dependabot-manifest-review: ${"6".repeat(64)} -->`;
  const updates = [{ name: "dotnet/sdk", from: "5", to: "6", kind: "major" }];
  const body = (text) => `✅ ${text}\n\n${marker}\n\n\u{1F916} Dependabot PR review by the Widgets routine`;
  assert.equal(readVerdict([{ ...OWNER, body: body("Manifest diff reviewed") }], updates, { manifestReviewMarker: marker }).verdict.versionsNamed, false);
  const named = readVerdict([{ ...OWNER, body: body("dotnet/sdk 6 reviewed") }], updates, { manifestReviewMarker: marker }).verdict;
  assert.equal(named.versionsNamed, true);
  assert.equal(named.manifestReviewed, true);
});

test("a replaced body with no update read can still be reviewed from its manifest diff", () => {
  const marker = `<!-- dependabot-manifest-review: ${"a".repeat(64)} -->`;
  const body = `✅ **VERIFIED LOW-RISK** vite 8.3.8 and react 19.2.1, from the manifest diff\n\n${marker}\n\u{1F916} Dependabot PR review by the Widgets routine`;
  const { verdict } = readVerdict([{ ...OWNER, body }], [], { manifestReviewMarker: marker });
  assert.equal(verdict.versionsNamed, true);
  assert.equal(verdict.manifestReviewed, true);
  assert.equal(verdictCurrent(verdict, { state: "passed" }), true);
  assert.equal(readVerdict([{ ...OWNER, body }], []).verdict.versionsNamed, false, "with no marker asked for, nothing read names nothing");
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
    { ...OWNER, body: `⚠️ **NEEDS EFFORT** jsdom 31.0.0 breaks${marker}`, created_at: "2026-11-01T00:00:00Z", html_url: "u1" },
    { user: PERSON, body: "hold this until the release", created_at: "2026-11-02T00:00:00Z" },
    { user: BOT, body: "Dependabot will resolve any conflicts", created_at: "2026-11-02T00:00:00Z" },
    { ...OWNER, body: `✅ **VERIFIED LOW-RISK** jsdom 31.0.0 and \`bef136a\` reviewed${marker}`, created_at: "2026-11-03T00:00:00Z", html_url: "u2" },
  ];
  const { verdict, comments: others } = readVerdict(comments, updates);
  assert.deepEqual(verdict, {
    kind: "low-risk",
    label: "Widgets",
    url: "u2",
    createdAt: "2026-11-03T00:00:00Z",
    versionsNamed: true,
    versionsUnnamed: [],
    manifestReviewed: null,
  });
  assert.deepEqual(others.map((comment) => comment.body), ["hold this until the release"]);
  assert.equal(readVerdict(comments.slice(0, 1), updates).verdict.kind, "needs-effort");
  assert.equal(readVerdict(comments.slice(0, 1), updates).verdict.versionsNamed, false);
  const retargeted = [{ name: "jsdom", from: "30.1.3", to: "31.0.1", kind: "major" }];
  assert.equal(readVerdict(comments, retargeted).verdict.versionsNamed, false);
  assert.equal(readVerdict([], updates).verdict, null);
});

test("only the owner, a member or a collaborator writes a verdict, and anyone else's is ignored", () => {
  const updates = [{ name: "jsdom", from: "30.1.3", to: "31.0.0", kind: "major" }];
  const marker = "\n\n\u{1F916} Dependabot PR review by the Widgets routine";
  const visitor = { login: "visitor", type: "User" };
  const byVisitor = (association) => ({
    user: visitor,
    author_association: association,
    body: `✅ **VERIFIED LOW-RISK** jsdom 31.0.0 reviewed${marker}`,
    created_at: "2026-11-04T00:00:00Z",
    html_url: "u3",
  });
  const needsEffort = { ...OWNER, body: `⚠️ **NEEDS EFFORT** jsdom 31.0.0 breaks${marker}`, created_at: "2026-11-01T00:00:00Z", html_url: "u1" };

  const later = readVerdict([needsEffort, byVisitor("NONE")], updates);
  assert.equal(later.verdict.kind, "needs-effort", "a later marked comment by someone else does not replace the verdict");
  assert.equal(later.verdict.url, "u1");
  assert.deepEqual(later.ignored, [{ author: "visitor", association: "NONE", url: "u3", createdAt: "2026-11-04T00:00:00Z" }]);
  assert.deepEqual(later.comments, [], "an ignored verdict is not a comment asking anything");

  for (const association of ["NONE", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "MANNEQUIN", undefined]) {
    const alone = readVerdict([byVisitor(association)], updates);
    assert.equal(alone.verdict, null, String(association));
    assert.equal(alone.ignored.length, 1, String(association));
  }
  for (const association of ["OWNER", "MEMBER", "COLLABORATOR"]) {
    const { verdict, ignored } = readVerdict([byVisitor(association)], updates);
    assert.equal(verdict.kind, "low-risk", association);
    assert.equal(verdictCurrent(verdict, { state: "passed" }), true, association);
    assert.deepEqual(ignored, [], association);
  }
});

test("list never counts a marked comment by someone without a role in the repository", () => {
  const routine = "\u{1F916} Dependabot PR review by the Widgets routine";
  const visitor = { user: { login: "visitor", type: "User" }, author_association: "NONE", html_url: "u3" };
  const parsedRepo = fakeRepo({
    pulls: [pull(1)],
    checkRuns: { [HEAD]: [{ name: "test", status: "completed", conclusion: "success" }] },
    comments: { 1: [{ ...visitor, body: `✅ **VERIFIED LOW-RISK** jsdom 31.0.1 reviewed\n\n${routine}` }] },
  });
  const parsedPr = runCommand(["list", "--repo", REPO], { rest: parsedRepo.rest }).prs[0];
  assert.equal(parsedPr.verdict, null);
  assert.deepEqual(parsedPr.ignoredVerdicts.map((comment) => comment.url), ["u3"]);

  // Carrying the PR's manifest marker does not make it a verdict either.
  const state = { pulls: [pull(1, { title: "Bump Scalar.AspNetCore and 1 other", body: NUGET })], comments: { 1: [] } };
  const unparsed = runCommand(["list", "--repo", REPO], { rest: fakeRepo(state).rest }).prs[0];
  state.comments[1].push({ ...visitor, body: `✅ **VERIFIED LOW-RISK** Scalar.AspNetCore 3.1.1\n\n${unparsed.manifestReviewMarker}\n${routine}` });
  const withMarker = runCommand(["list", "--repo", REPO], { rest: fakeRepo(state).rest }).prs[0];
  assert.equal(withMarker.verdict, null);
  assert.equal(withMarker.ignoredVerdicts.length, 1);
});

test("a verdict must name a pinned update's current version", () => {
  const comments = [{
    ...OWNER,
    body: "✅ **VERIFIED LOW-RISK** Azure.Storage.Blobs 12.30.2, Npgsql 10.0.4 and Scalar.AspNetCore 3.2.0\n\n\u{1F916} Dependabot PR review by the Widgets routine",
  }];
  assert.equal(readVerdict(comments, parseUpdates(PINNED_TITLE, PINNED_NUGET)).verdict.versionsNamed, true);
  const retargeted = parseUpdates(PINNED_TITLE, PINNED_NUGET.replace("12.30.2", "13.0.0"));
  assert.equal(readVerdict(comments, retargeted).verdict.versionsNamed, false);
  assert.deepEqual(readVerdict(comments, retargeted).verdict.versionsUnnamed, ["Azure.Storage.Blobs@13.0.0"]);
});

// LeaseBook #824: a grouped verdict that sums members up ("and seven patches") never names them,
// so it is stale as it lands, and `versionsUnnamed` says which ones (skills#125).
test("versionsUnnamed lists each update a verdict does not name, as name@version", () => {
  const group = [["react", "19.2.1"], ["vite", "8.3.8"], ["vitest", "4.0.3"], ["semver", "7.7.4"]].map(([name, to]) => ({ name, from: null, to, kind: "patch" }));
  const say = (text) => [{ ...OWNER, body: `✅ **VERIFIED LOW-RISK** ${text}\n\n\u{1F916} Dependabot PR review by the Widgets routine` }];
  const summed = readVerdict(say("react 19.2.1 and vite 8.3.8, and two patches"), group).verdict;
  assert.equal(summed.versionsNamed, false);
  assert.deepEqual(summed.versionsUnnamed, ["vitest@4.0.3", "semver@7.7.4"]);
  const full = readVerdict(say("react 19.2.1, vite 8.3.8, vitest 4.0.3 and semver 7.7.4"), group).verdict;
  assert.equal(full.versionsNamed, true);
  assert.deepEqual(full.versionsUnnamed, []);
});

test("a version counts as named only on its own, never inside a longer version", () => {
  const x = [{ name: "x", from: "5.1.0", to: "5.1.1", kind: "patch" }];
  const named = (text) => readVerdict([{ ...OWNER, body: `✅ x ${text} reviewed\n\n\u{1F916} Dependabot PR review by the Widgets routine` }], x).verdict.versionsNamed;
  for (const text of ["5.1.10", "5.1.1.2", "15.1.1", "1.5.1.1"]) assert.equal(named(text), false, text);
  for (const text of ["5.1.1", "`5.1.1`", "v5.1.1", "5.1.1.", "(5.1.1)", "5.1.0 → 5.1.1,", "x@5.1.1", "5.1.10 and 5.1.1"]) {
    assert.equal(named(text), true, text);
  }
});

test("a low-risk verdict stays current only while it names the versions and the checks have not failed", () => {
  const lowRisk = { kind: "low-risk", versionsNamed: true };
  assert.equal(verdictCurrent(lowRisk, { state: "passed" }), true);
  assert.equal(verdictCurrent(lowRisk, { state: "pending" }), true);
  assert.equal(verdictCurrent(lowRisk, { state: "failed" }), false);
  assert.equal(verdictCurrent({ ...lowRisk, versionsNamed: false }, { state: "passed" }), false);
  assert.equal(verdictCurrent({ kind: "needs-effort", versionsNamed: false }, { state: "failed" }), true);
  assert.equal(verdictCurrent({ kind: "needs-effort", versionsNamed: true }, { state: "passed" }), true);
  assert.equal(verdictCurrent({ ...lowRisk, manifestReviewed: true }, { state: "passed" }), true);
  assert.equal(verdictCurrent({ ...lowRisk, manifestReviewed: false }, { state: "passed" }), false);
  assert.equal(verdictCurrent({ kind: "needs-effort", versionsNamed: true, manifestReviewed: false }, { state: "passed" }), true);
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

function fakeRepo({ pulls, checkRuns = {}, commits = {}, comments = {}, files = {} }) {
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
    match = endpoint.match(/^repos\/acme\/widgets\/pulls\/(\d+)\/files\?per_page=100$/);
    if (match) return files[match[1]] ?? [];
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
  assert.ok(!repo.calls.some((call) => call.includes("/files")), "a parsed PR's diff is not read");
  assert.equal(first.parsed, true);
  assert.equal(first.manifestReviewMarker, null);
});

test("a PR reviewed from its manifest diff stays reviewed until its title or diff changes", () => {
  const props = (version) => [{
    filename: "Directory.Packages.props",
    status: "modified",
    sha: "1".repeat(40),
    patch: `@@ -4,1 +4,1 @@\n-<Pkg Include="Scalar.AspNetCore" Version="3.0.0" />\n+<Pkg Include="Scalar.AspNetCore" Version="${version}" />`,
  }];
  const comments = { 1: [] };
  const passed = [{ name: "test", status: "completed", conclusion: "success" }];
  const state = { pulls: [pull(1, { title: "Bump Scalar.AspNetCore and 1 other", body: NUGET })], checkRuns: { [HEAD]: passed }, comments, files: { 1: props("3.1.1") } };
  const list = () => runCommand(["list", "--repo", REPO], { rest: fakeRepo(state).rest }).prs[0];

  const unreviewed = list();
  assert.equal(unreviewed.parsed, false);
  assert.equal(unreviewed.expected, 2);
  assert.deepEqual(unreviewed.missing, []);
  assert.equal(unreviewed.kind, "unknown");
  assert.match(unreviewed.manifestReviewMarker, /^<!-- dependabot-manifest-review: [0-9a-f]{64} -->$/);

  const routine = "\u{1F916} Dependabot PR review by the Widgets routine";
  const text = "✅ **VERIFIED LOW-RISK** Scalar.AspNetCore 3.1.1 and Azure.Storage.Blobs 12.30.2, from the manifest diff";
  comments[1].push({ ...OWNER, body: `${text}\n\n${routine}` });
  assert.equal(list().verdict.current, false, "without the marker, the manifest review is not recorded");

  comments[1].push({ ...OWNER, body: `${text}\n\n${unreviewed.manifestReviewMarker}\n${routine}` });
  assert.equal(list().verdict.current, true);
  state.pulls = [pull(1, { title: "Bump Scalar.AspNetCore and 1 other", body: NUGET, head: { ...pull(1).head, sha: NEW_HEAD }, base: { sha: "c".repeat(40) } })];
  state.checkRuns[NEW_HEAD] = passed;
  assert.equal(list().verdict.current, true, "a rebase keeps the review");

  state.checkRuns[NEW_HEAD] = [{ name: "test", status: "completed", conclusion: "failure" }];
  assert.equal(list().verdict.current, false, "failed checks end it");
  state.checkRuns[NEW_HEAD] = passed;

  state.files[1] = props("3.1.2");
  assert.equal(list().verdict.current, false, "a retarget ends it");

  state.files[1] = props("3.1.1");
  comments[1].push({ ...OWNER, body: `⚠️ **NEEDS EFFORT** Scalar.AspNetCore 3.1.1 breaks\n\n${routine}` });
  assert.equal(list().verdict.current, true, "a needs-effort verdict stays current without the marker");
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
