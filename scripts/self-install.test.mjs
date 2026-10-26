import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { localSkills, selfInstall } from "./self-install.mjs";

function write(root, rel, content) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), content);
}

function withFixture(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "self-install-"));
  try {
    write(
      root,
      "skills-lock.json",
      JSON.stringify({
        version: 1,
        skills: {
          handoff: { source: ".", sourceType: "local" },
          grilling: { source: "someone/skills", sourceType: "github" },
        },
      }),
    );
    write(root, "skills/handoff/SKILL.md", "v1\n");
    write(root, "skills/handoff/settings/README.md", "conventions\n");
    write(root, ".agents/skills/grilling/SKILL.md", "theirs\n");
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("only skills installed from this checkout are refreshed", () => {
  withFixture((root) => {
    assert.deepEqual(localSkills(root), ["handoff"]);
    assert.deepEqual(selfInstall(root, { check: true }).stale, [
      ".agents/skills/handoff/SKILL.md (missing)",
      ".agents/skills/handoff/settings/README.md (missing)",
    ]);
    selfInstall(root);
    assert.equal(readFileSync(path.join(root, ".agents/skills/handoff/SKILL.md"), "utf8"), "v1\n");
    assert.equal(
      readFileSync(path.join(root, ".agents/skills/grilling/SKILL.md"), "utf8"),
      "theirs\n",
    );
    assert.deepEqual(selfInstall(root, { check: true }).stale, []);
  });
});

test("--check reports edited and orphaned files without writing; a refresh removes them", () => {
  withFixture((root) => {
    selfInstall(root);
    write(root, "skills/handoff/SKILL.md", "v2\n");
    write(root, ".agents/skills/handoff/old.md", "gone\n");
    assert.deepEqual(selfInstall(root, { check: true }).stale, [
      ".agents/skills/handoff/SKILL.md",
      ".agents/skills/handoff/old.md (orphaned)",
    ]);
    assert.ok(existsSync(path.join(root, ".agents/skills/handoff/old.md")));
    selfInstall(root);
    assert.deepEqual(selfInstall(root, { check: true }).stale, []);
    assert.ok(!existsSync(path.join(root, ".agents/skills/handoff/old.md")));
  });
});
