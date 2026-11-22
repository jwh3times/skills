import assert from "node:assert/strict";
import test from "node:test";

import {
  LandError,
  locateMerge,
  mentionedNumbers,
  parseArgs,
  parseLinkLine,
  parseRules,
  prVerdict,
  releaseVerdict,
  runCommand,
  summarizeChecks,
  tagsAt,
} from "../skills/land/land.mjs";

const REPO = "acme/widgets";
const HEAD = "a".repeat(40);
const MERGE = "b".repeat(40);
const STAMP = "c".repeat(40);
const OTHER = "d".repeat(40);
const BASE = "e".repeat(40);

function checkRun(name, { status = "COMPLETED", conclusion = "SUCCESS", required = true, runStatus = null } = {}) {
  return {
    typename: "CheckRun",
    name,
    status,
    conclusion: status === "COMPLETED" ? conclusion : null,
    title: null,
    detailsUrl: `https://example.test/${encodeURIComponent(name)}`,
    isRequired: required,
    checkSuite: {
      app: { slug: "github-actions" },
      workflowRun: {
        databaseId: 11,
        event: "pull_request",
        workflow: { name: "CI" },
        checkSuite: { status: runStatus ?? (status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS") },
      },
    },
  };
}

function pullRequest(overrides = {}) {
  return {
    number: 7,
    title: "Add the widget",
    url: "https://github.com/acme/widgets/pull/7",
    body: "Closes #3\n\nSee #4 for the follow-up.",
    state: "OPEN",
    isDraft: false,
    mergedAt: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "feat/3-widget",
    headRefOid: HEAD,
    baseRefName: "main",
    author: { typename: "User", login: "someone" },
    mergeCommit: null,
    closing: [{ number: 3, state: "OPEN", repo: REPO }],
    contexts: [checkRun("test"), checkRun("lint")],
    ...overrides,
  };
}

const RULES = [
  { type: "deletion" },
  {
    type: "required_status_checks",
    parameters: {
      strict_required_status_checks_policy: true,
      required_status_checks: [{ context: "test" }, { context: "lint" }],
    },
  },
  { type: "pull_request", parameters: { allowed_merge_methods: ["merge", "squash"] } },
  { type: "code_scanning", parameters: { code_scanning_tools: [{ tool: "CodeQL" }] } },
];

// A repository held in memory. Each read takes the next of a list of PR states, so a wait can be
// replayed; the last state repeats.
function fakeRepo({ prs = [pullRequest()], rules = RULES, issues = { 4: "OPEN" }, alerts = [], runs = [], history, tags = [], workflowRuns = {}, checkRuns = {}, failures = [] } = {}) {
  const calls = [];
  let prIndex = 0;
  const failNext = [...failures];
  const fail = () => {
    const next = failNext.shift();
    if (next) {
      const error = new LandError(next.message);
      error.retryable = next.retryable;
      throw error;
    }
  };
  const graphql = (query, variables, options) => {
    calls.push({ kind: "graphql", query, variables, options });
    fail();
    if (query.startsWith("query Pr(")) {
      const pr = prs[Math.min(prIndex, prs.length - 1)];
      prIndex += 1;
      return {
        repository: {
          pullRequest: {
            ...pr,
            closingIssuesReferences: {
              nodes: pr.closing.map((ref) => ({ number: ref.number, state: ref.state, repository: { nameWithOwner: ref.repo } })),
            },
            commits: { nodes: [{ commit: { oid: pr.headRefOid, statusCheckRollup: { contexts: { nodes: pr.contexts } } } }] },
          },
        },
      };
    }
    if (query.startsWith("query Issues(")) {
      const repository = {};
      for (const match of query.matchAll(/i(\d+): issueOrPullRequest/g)) {
        const number = Number(match[1]);
        repository[`i${number}`] = issues[number] ? { typename: "Issue", number, state: issues[number] } : null;
      }
      return { repository };
    }
    if (query.startsWith("query Main(")) {
      return {
        repository: {
          defaultBranchRef: { name: "main", target: { history: { nodes: history } } },
          refs: { nodes: tags },
        },
      };
    }
    throw new Error(`unexpected query ${query.slice(0, 30)}`);
  };
  const rest = (endpoint) => {
    calls.push({ kind: "rest", endpoint });
    fail();
    if (endpoint.includes("/rules/branches/")) return rules;
    if (endpoint.includes("/code-scanning/alerts")) return alerts;
    if (endpoint.includes("/actions/runs?head_sha=")) return { workflow_runs: runs };
    const workflow = /\/actions\/workflows\/([^/]+)\/runs/.exec(endpoint);
    if (workflow) return { workflow_runs: workflowRuns[decodeURIComponent(workflow[1])] ?? [] };
    const check = /\/check-runs\?check_name=([^&]+)/.exec(endpoint);
    if (check) return { check_runs: checkRuns[decodeURIComponent(check[1])] ?? [] };
    throw new Error(`unexpected endpoint ${endpoint}`);
  };
  return { graphql, rest, calls };
}

// A clock that only moves when the script sleeps.
function clock() {
  let time = 0;
  return { now: () => time, sleep: (ms) => (time += ms), elapsed: () => time };
}

function runWith(repo, argv) {
  const time = clock();
  const result = runCommand(argv, { graphql: repo.graphql, rest: repo.rest, sleep: time.sleep, now: time.now });
  return { result, slept: time.elapsed() };
}

const commit = (oid, headline, parent) => ({ oid, messageHeadline: headline, parents: { nodes: parent ? [{ oid: parent }] : [] } });

test("parseArgs reads each command and refuses what does not fit it", () => {
  assert.deepEqual(parseArgs(["pr", "--repo", REPO, "--pr", "#7", "--wait", "300"]).pr, 7);
  assert.equal(parseArgs(["pr", "--repo", REPO, "--pr", "7", "--expect-head", HEAD.toUpperCase()]).expectHead, HEAD);
  assert.deepEqual(parseArgs(["runs", "--repo", REPO, "--sha", MERGE, "--workflow", "deploy.yml", "--check", "Pages"]).checks, ["Pages"]);
  assert.throws(() => parseArgs(["merge", "--repo", REPO]), /expected one of/);
  assert.throws(() => parseArgs(["pr", "--pr", "7"]), /--repo/);
  assert.throws(() => parseArgs(["pr", "--repo", REPO]), /--pr/);
  assert.throws(() => parseArgs(["release", "--repo", REPO, "--sha", "abc1234", "--workflow", "v.yml"]), /full 40-character sha/);
  assert.throws(() => parseArgs(["release", "--repo", REPO, "--sha", MERGE]), /exactly one --workflow/);
  assert.throws(() => parseArgs(["runs", "--repo", REPO, "--sha", MERGE]), /at least one/);
  assert.throws(() => parseArgs(["pr", "--repo", REPO, "--pr", "7", "--wait"]), /needs a value/);
  assert.throws(() => parseArgs(["pr", "--repo", "widgets", "--pr", "7"]), /owner\/name/);
});

test("checks are summarized: failures, pending, stuck, cancelled duplicates and required checks that never ran", () => {
  const summary = summarizeChecks(
    [
      checkRun("test"),
      checkRun("lint", { conclusion: "FAILURE" }),
      checkRun("e2e", { status: "IN_PROGRESS" }),
      checkRun("changelog", { status: "IN_PROGRESS", runStatus: "COMPLETED" }),
      checkRun("build", { conclusion: "CANCELLED" }),
      checkRun("build"),
      checkRun("deploy", { conclusion: "SKIPPED", required: false }),
      { typename: "StatusContext", context: "Pages", state: "PENDING", isRequired: false, description: "Building" },
    ],
    ["test", "lint", "Verify generated agent config"],
  );
  assert.deepEqual(summary.failed, ["lint"]);
  assert.deepEqual(summary.pending, ["e2e", "changelog", "Pages"]);
  assert.deepEqual(summary.stuck, ["changelog"]);
  assert.deepEqual(summary.cancelledDuplicates, ["build"]);
  assert.deepEqual(summary.missingRequired, ["Verify generated agent config"]);
  assert.equal(summary.items.find((check) => check.name === "Pages").kind, "status");
});

test("the branch rules give the required checks, strictness, merge methods and the code scanning gate", () => {
  assert.deepEqual(parseRules(RULES), {
    requiredContexts: ["test", "lint"],
    strict: true,
    mergeMethods: ["merge", "squash"],
    codeScanning: true,
  });
  assert.deepEqual(parseRules([]), { requiredContexts: [], strict: false, mergeMethods: null, codeScanning: false });
});

test("the verdict reads state, head, conflicts, checks and then GitHub's merge state, in that order", () => {
  const none = { failed: [], pending: [], missingRequired: [] };
  const pr = (overrides) => ({ state: "OPEN", isDraft: false, headRefOid: HEAD, mergeStateStatus: "CLEAN", mergeable: "MERGEABLE", ...overrides });
  assert.equal(prVerdict(pr({ state: "MERGED" }), none), "merged");
  assert.equal(prVerdict(pr({ state: "CLOSED" }), none), "closed");
  assert.equal(prVerdict(pr({}), none, OTHER), "head-moved");
  assert.equal(prVerdict(pr({ isDraft: true }), none), "draft");
  assert.equal(prVerdict(pr({ mergeStateStatus: "DIRTY" }), { ...none, failed: ["x"] }), "conflicts");
  assert.equal(prVerdict(pr({ mergeStateStatus: "BEHIND" }), { ...none, failed: ["x"], pending: ["y"] }), "failed");
  assert.equal(prVerdict(pr({ mergeStateStatus: "BEHIND" }), { ...none, pending: ["y"], missingRequired: ["z"] }), "pending");
  assert.equal(prVerdict(pr({ mergeStateStatus: "BLOCKED" }), { ...none, missingRequired: ["z"] }), "missing-checks");
  assert.equal(prVerdict(pr({ mergeStateStatus: "BEHIND" }), none), "behind");
  assert.equal(prVerdict(pr({ mergeStateStatus: "BLOCKED" }), none), "blocked");
  assert.equal(prVerdict(pr({ mergeStateStatus: "UNKNOWN" }), none), "pending");
  assert.equal(prVerdict(pr({}), none, HEAD), "ready");
});

test("the link line names what the PR means to close, and other references are mentions", () => {
  const repo = { owner: "acme", name: "widgets" };
  assert.deepEqual(parseLinkLine("\n  Closes #3 and fixes acme/tools#9\nresolves #12", repo).closes, [
    { repo: REPO, number: 3 },
    { repo: "acme/tools", number: 9 },
  ]);
  assert.deepEqual(parseLinkLine("Part of #469.", repo).partOf, [{ repo: REPO, number: 469 }]);
  assert.deepEqual(parseLinkLine("", repo), { text: "", closes: [], partOf: [] });
  assert.deepEqual(mentionedNumbers("Closes #3. Follows #4, not &#39; or a/b#5; #4 again; #6", new Set([3])), [4, 6]);
});

test("pr reports a ready PR with its checks, closing issues and the issues it only mentions", () => {
  const repo = fakeRepo();
  const { result } = runWith(repo, ["pr", "--repo", REPO, "--pr", "7"]);
  assert.equal(result.verdict, "ready");
  assert.equal(result.headSha, HEAD);
  assert.deepEqual(result.closing, [{ repo: REPO, number: 3, state: "OPEN" }]);
  assert.deepEqual(result.unexpectedClosing, []);
  assert.deepEqual(result.mentioned, [{ number: 4, kind: "issue", state: "OPEN" }]);
  assert.equal(result.rules.strict, true);
  assert.equal(result.codeScanningAlerts, undefined);
  const issues = repo.calls.find((call) => call.query?.startsWith("query Issues("));
  assert.deepEqual(issues.options, { allowNotFound: true });
});

test("a closing reference the link line does not name, or names as Part of, is unexpected", () => {
  const partOf = fakeRepo({ prs: [pullRequest({ body: "Part of #3.", closing: [{ number: 3, state: "OPEN", repo: REPO }] })] });
  assert.deepEqual(runWith(partOf, ["pr", "--repo", REPO, "--pr", "7"]).result.unexpectedClosing, [
    { repo: REPO, number: 3, state: "OPEN" },
  ]);
  const negated = fakeRepo({
    prs: [pullRequest({ body: "Closes #3\n\nThis does not close #22.", closing: [{ number: 3, state: "OPEN", repo: REPO }, { number: 22, state: "OPEN", repo: REPO }] })],
  });
  assert.deepEqual(runWith(negated, ["pr", "--repo", REPO, "--pr", "7"]).result.unexpectedClosing.map((ref) => ref.number), [22]);
});

test("a bot's PR skips the mention lookup, and a Dependabot author is flagged", () => {
  const repo = fakeRepo({ prs: [pullRequest({ author: { typename: "Bot", login: "dependabot" }, body: "Bumps x. See #1314 upstream.", closing: [] })] });
  const { result } = runWith(repo, ["pr", "--repo", REPO, "--pr", "7"]);
  assert.equal(result.dependabot, true);
  assert.deepEqual(result.mentioned, []);
  assert.equal(repo.calls.some((call) => call.query?.startsWith("query Issues(")), false);
});

test("a blocked PR with every check green lists its open code scanning alerts", () => {
  const alerts = [{ number: 41, rule: { id: "js/xss", security_severity_level: "high" }, most_recent_instance: { location: { path: "a.js", start_line: 3 } }, html_url: "u" }];
  const repo = fakeRepo({ prs: [pullRequest({ mergeStateStatus: "BLOCKED" })], alerts });
  const { result } = runWith(repo, ["pr", "--repo", REPO, "--pr", "7"]);
  assert.equal(result.verdict, "blocked");
  assert.deepEqual(result.codeScanningAlerts, [{ number: 41, rule: "js/xss", severity: "high", path: "a.js", line: 3, url: "u" }]);
  const endpoint = repo.calls.find((call) => call.endpoint?.includes("code-scanning")).endpoint;
  assert.match(endpoint, /ref=refs%2Fpull%2F7%2Fhead&state=open/);
});

test("waiting polls until the checks finish, and stops at the deadline", () => {
  const pending = pullRequest({ contexts: [checkRun("test", { status: "IN_PROGRESS" }), checkRun("lint")] });
  const repo = fakeRepo({ prs: [pending, pending, pullRequest()] });
  const { result, slept } = runWith(repo, ["pr", "--repo", REPO, "--pr", "7", "--wait", "300"]);
  assert.equal(result.verdict, "ready");
  assert.equal(result.timedOut, false);
  assert.equal(slept, 40_000);

  const stuck = fakeRepo({ prs: [pending] });
  const timedOut = runWith(stuck, ["pr", "--repo", REPO, "--pr", "7", "--wait", "60"]);
  assert.equal(timedOut.result.verdict, "pending");
  assert.equal(timedOut.result.timedOut, true);
  assert.ok(timedOut.slept <= 60_000);

  const once = runWith(fakeRepo({ prs: [pending] }), ["pr", "--repo", REPO, "--pr", "7"]);
  assert.equal(once.slept, 0);
  assert.equal(once.result.timedOut, undefined);
});

test("a required check absent right after a push is waited for, then reported as missing", () => {
  const missing = pullRequest({ contexts: [checkRun("test")], mergeStateStatus: "BLOCKED" });
  const { result, slept } = runWith(fakeRepo({ prs: [missing] }), ["pr", "--repo", REPO, "--pr", "7", "--wait", "600"]);
  assert.equal(result.verdict, "missing-checks");
  assert.deepEqual(result.checks.missingRequired, ["lint"]);
  assert.equal(slept, 120_000);
});

test("a new head stops the wait as head-moved", () => {
  const { result } = runWith(fakeRepo({ prs: [pullRequest({ headRefOid: OTHER })] }), [
    "pr", "--repo", REPO, "--pr", "7", "--expect-head", HEAD, "--wait", "300",
  ]);
  assert.equal(result.verdict, "head-moved");
});

test("--moved-from waits past the old head's behind or conflicts until a new head arrives", () => {
  const behind = pullRequest({ mergeStateStatus: "BEHIND" });
  const conflicting = pullRequest({ mergeStateStatus: "DIRTY", mergeable: "CONFLICTING" });
  const moved = pullRequest({ headRefOid: OTHER });
  const repo = fakeRepo({ prs: [conflicting, behind, moved] });
  const { result, slept } = runWith(repo, ["pr", "--repo", REPO, "--pr", "7", "--moved-from", HEAD, "--wait", "300"]);
  assert.equal(result.headSha, OTHER);
  assert.equal(result.verdict, "ready", "the new head's own verdict");
  assert.equal(result.timedOut, false);
  assert.equal(slept, 40_000);

  const never = runWith(fakeRepo({ prs: [behind] }), ["pr", "--repo", REPO, "--pr", "7", "--moved-from", HEAD, "--wait", "60"]);
  assert.equal(never.result.verdict, "behind");
  assert.equal(never.result.timedOut, true);

  const merged = runWith(fakeRepo({ prs: [pullRequest({ state: "MERGED" })] }), ["pr", "--repo", REPO, "--pr", "7", "--moved-from", HEAD, "--wait", "300"]);
  assert.equal(merged.result.verdict, "merged");
  assert.equal(merged.slept, 0);

  assert.throws(() => parseArgs(["pr", "--repo", REPO, "--pr", "7", "--moved-from", HEAD, "--expect-head", HEAD]), /not both/);
  assert.throws(() => parseArgs(["release", "--repo", REPO, "--sha", MERGE, "--workflow", "v.yml", "--moved-from", HEAD]), /only pr/);
});

test("every query asks for __typename as typename, which some consumers' lint requires", () => {
  const repo = fakeRepo({
    prs: [pullRequest({ mergeStateStatus: "BLOCKED" })],
    history: [commit(MERGE, "Merge pull request #7", BASE)],
  });
  runWith(repo, ["pr", "--repo", REPO, "--pr", "7"]);
  runWith(repo, ["release", "--repo", REPO, "--sha", MERGE, "--workflow", "version.yml"]);
  const queries = repo.calls.filter((call) => call.kind === "graphql").map((call) => call.query);
  assert.deepEqual(
    queries.map((query) => query.split("(")[0]),
    ["query Pr", "query Issues", "query Main"],
  );
  for (const query of queries) assert.doesNotMatch(query, /(?<!typename: )__typename/);
});

test("a failed call is retried on the next poll, but only a retryable one, and only twice", () => {
  const recovered = fakeRepo({ failures: [{ message: "TLS handshake timeout", retryable: true }] });
  const { result } = runWith(recovered, ["pr", "--repo", REPO, "--pr", "7", "--wait", "120"]);
  assert.equal(result.verdict, "ready");
  assert.equal(result.recoveredFrom, "TLS handshake timeout");

  const flaky = fakeRepo({ failures: Array(3).fill({ message: "HTTP 502", retryable: true }) });
  assert.throws(() => runWith(flaky, ["pr", "--repo", REPO, "--pr", "7", "--wait", "300"]), /HTTP 502/);

  const fatal = fakeRepo({ failures: [{ message: "Bad credentials", retryable: false }] });
  assert.throws(() => runWith(fatal, ["pr", "--repo", REPO, "--pr", "7", "--wait", "300"]), /Bad credentials/);
});

test("the merge's stamp commits and what landed since are found on the default branch", () => {
  const history = [
    commit(OTHER, "Merge pull request #8", STAMP),
    commit(STAMP, "chore(release): v1.2.3 [skip ci]", MERGE),
    commit(MERGE, "Merge pull request #7", BASE),
    commit(BASE, "older", null),
  ];
  assert.deepEqual(locateMerge(history, MERGE), {
    onMain: true,
    stamps: [{ sha: STAMP, headline: "chore(release): v1.2.3 [skip ci]" }],
    landedSince: [{ sha: OTHER, headline: "Merge pull request #8" }],
  });
  assert.deepEqual(locateMerge(history, HEAD), { onMain: false, stamps: [], landedSince: [] });
  // A release commit that is not on top of the merge is another merge's stamp.
  const elsewhere = [commit(STAMP, "chore(release): v1.2.4 [skip ci]", OTHER), commit(MERGE, "Merge pull request #7", BASE)];
  assert.deepEqual(locateMerge(elsewhere, MERGE).stamps, []);
  assert.deepEqual(
    tagsAt(
      [
        { name: "v1.2.3", target: { typename: "Tag", oid: "t1", target: { oid: MERGE } } },
        { name: "v1.2.2", target: { typename: "Commit", oid: BASE } },
        { name: "light", target: { typename: "Commit", oid: MERGE } },
      ],
      MERGE,
    ),
    ["v1.2.3", "light"],
  );
});

const run_ = (overrides) => ({
  id: 1,
  name: "Version",
  path: ".github/workflows/version.yml",
  event: "push",
  head_sha: MERGE,
  status: "completed",
  conclusion: "success",
  run_attempt: 1,
  created_at: "t",
  html_url: "u",
  ...overrides,
});

test("the release verdict follows the run for the merge's sha and the tag on the merge", () => {
  assert.equal(releaseVerdict([], []), "no-run");
  assert.equal(releaseVerdict([{ status: "in_progress" }], []), "running");
  assert.equal(releaseVerdict([{ status: "completed", conclusion: "failure" }], []), "failed");
  assert.equal(releaseVerdict([{ status: "completed", conclusion: "success" }], []), "untagged");
  assert.equal(releaseVerdict([{ status: "completed", conclusion: "success" }], ["v1"]), "released");
});

test("release finds the workflow's run by the merge sha, ignoring other workflows' runs", () => {
  const repo = fakeRepo({
    runs: [run_(), run_({ id: 2, name: "CI", path: ".github/workflows/ci.yml", status: "in_progress", conclusion: null })],
    history: [commit(STAMP, "chore(release): v1.2.3 [skip ci]", MERGE), commit(MERGE, "Merge pull request #7", BASE)],
    tags: [{ name: "v1.2.3", target: { typename: "Tag", oid: "t1", target: { oid: MERGE } } }],
  });
  const { result } = runWith(repo, ["release", "--repo", REPO, "--sha", MERGE, "--workflow", "version.yml"]);
  assert.equal(result.verdict, "released");
  assert.deepEqual(result.runs.map((r) => r.id), [1]);
  assert.deepEqual(result.main.tags, ["v1.2.3"]);
  assert.equal(result.main.stamps[0].sha, STAMP);
  assert.ok(repo.calls.some((call) => call.endpoint === `repos/acme/widgets/actions/runs?head_sha=${MERGE}&per_page=100`));
});

test("runs matches a workflow_run deploy by the stamp commit it lists, and a deploy check by name", () => {
  const repo = fakeRepo({
    history: [commit(STAMP, "chore(release): v1.2.3 [skip ci]", MERGE), commit(MERGE, "Merge pull request #7", BASE)],
    workflowRuns: {
      "deploy.yml": [
        run_({ id: 5, name: "Deploy", path: ".github/workflows/deploy.yml", event: "workflow_run", head_sha: STAMP, status: "in_progress", conclusion: null }),
        run_({ id: 4, name: "Deploy", path: ".github/workflows/deploy.yml", event: "workflow_run", head_sha: BASE }),
      ],
    },
    checkRuns: { "Cloudflare Pages": [{ id: 9, name: "Cloudflare Pages", head_sha: MERGE, status: "completed", conclusion: "success", output: { title: "Deployed" } }] },
  });
  const { result } = runWith(repo, ["runs", "--repo", REPO, "--sha", MERGE, "--workflow", "deploy.yml", "--check", "Cloudflare Pages"]);
  assert.equal(result.verdict, "running");
  assert.deepEqual(result.watched[0].runs.map((r) => r.id), [5]);
  assert.equal(result.watched[1].state, "success");
  assert.equal(result.watched[1].runs[0].title, "Deployed");
});

test("runs with no run yet waits two minutes for one to start, then reports waiting", () => {
  const repo = fakeRepo({ history: [commit(MERGE, "Merge pull request #7", BASE)], workflowRuns: {} });
  const { result, slept } = runWith(repo, ["runs", "--repo", REPO, "--sha", MERGE, "--workflow", "deploy.yml", "--wait", "600"]);
  assert.equal(result.verdict, "waiting");
  assert.equal(slept, 120_000);
});
