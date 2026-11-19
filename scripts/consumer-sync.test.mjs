import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { planScripts, syncConsumer } from "./consumer-sync.mjs";

function write(root, rel, content) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), content);
}

function withFixture(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "consumer-sync-"));
  const upstream = path.join(base, "skills");
  const consumer = path.join(base, "consumer");
  try {
    write(
      upstream,
      "settings/agents-md.md",
      [
        "npx skills add jwh3times/skills -s ship -a codex --copy -y",
        "npx skills add someone/skills#abc \\",
        "  -s tdd -a codex --copy -y",
      ].join("\n"),
    );
    for (const base of ["sync-agents", "check-skills", "check-docs", "lint-agent-neutrality", "check-changelog", "stamp-changelog"]) {
      write(upstream, `scripts/${base}.mjs`, `new ${base}\n`);
      write(upstream, `scripts/${base}.test.mjs`, `new ${base} test\n`);
    }
    for (const base of ["sync-agents", "check-skills", "check-docs", "lint-agent-neutrality", "check-changelog"]) {
      write(consumer, `scripts/${base}.mjs`, `old ${base}\n`);
      write(consumer, `scripts/${base}.test.mjs`, `old ${base} test\n`);
    }
    write(consumer, "scripts/own.mjs", "the consumer's own\n");
    fn({ upstream, consumer });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test("scripts: every always-carried one, and an optional one only where the consumer has it", () => {
  withFixture(({ upstream, consumer }) => {
    assert.deepEqual(planScripts(consumer, upstream), [
      "sync-agents.mjs",
      "sync-agents.test.mjs",
      "lint-agent-neutrality.mjs",
      "lint-agent-neutrality.test.mjs",
      "check-docs.mjs",
      "check-docs.test.mjs",
      "check-skills.mjs",
      "check-skills.test.mjs",
      "check-changelog.mjs",
      "check-changelog.test.mjs",
    ]);
  });
});

test("sync installs, copies the scripts, then runs the new sync-agents", () => {
  withFixture(({ upstream, consumer }) => {
    const calls = [];
    const run = (command, args, cwd) => {
      const syncAgents = readFileSync(path.join(consumer, "scripts", "sync-agents.mjs"), "utf8");
      calls.push({ command, args: args.join(" "), cwd, syncAgents });
    };
    syncConsumer(consumer, { upstreamRoot: upstream, run });
    assert.deepEqual(
      calls.map(({ command, args, cwd, syncAgents }) => [command, args, cwd === consumer, syncAgents]),
      [
        ["npx", "skills add jwh3times/skills -s ship -a codex --copy -y", true, "old sync-agents\n"],
        ["npx", "skills add someone/skills#abc -s tdd -a codex --copy -y", true, "old sync-agents\n"],
        ["node", "scripts/sync-agents.mjs", true, "new sync-agents\n"],
      ],
    );
    assert.equal(readFileSync(path.join(consumer, "scripts", "check-changelog.test.mjs"), "utf8"), "new check-changelog test\n");
    assert.equal(readFileSync(path.join(consumer, "scripts", "own.mjs"), "utf8"), "the consumer's own\n");
    assert.throws(() => readFileSync(path.join(consumer, "scripts", "stamp-changelog.mjs")), /ENOENT/);
  });
});

test("a dry run changes nothing, and a checkout without sync-agents is refused", () => {
  withFixture(({ upstream, consumer }) => {
    const plan = syncConsumer(consumer, { upstreamRoot: upstream, dryRun: true, run: () => assert.fail("ran") });
    assert.equal(plan.commands.length, 3);
    assert.equal(readFileSync(path.join(consumer, "scripts", "check-skills.mjs"), "utf8"), "old check-skills\n");
    assert.throws(() => syncConsumer(upstream + "-none", { upstreamRoot: upstream }), /no scripts\/sync-agents\.mjs/);
  });
});
