import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildSettings, readTopics } from "./build-settings.mjs";

function write(root, rel, content) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), content);
}

function withFixture(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "build-settings-"));
  try {
    write(root, "settings/README.md", "# Conventions\n");
    write(root, "settings/workspace.md", "# Topic: workspace\n");
    write(root, "settings/docs.md", "# Topic: docs\n");
    write(
      root,
      "skills/end-session/SKILL.md",
      "---\nname: end-session\ndescription: Close out.\nmetadata:\n  settings: workspace docs\n---\n\nBody.\n",
    );
    write(root, "skills/plain/SKILL.md", "---\nname: plain\ndescription: No settings.\n---\n");
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const read = (root, rel) => readFileSync(path.join(root, rel), "utf8");

test("topics are read from metadata, and only from metadata", () => {
  assert.deepEqual(
    readTopics("x", "---\nname: x\nmetadata:\n  owner: me\n  settings: a  b\n---\n"),
    ["a", "b"],
  );
  assert.deepEqual(readTopics("x", "---\nname: x\nsettings: a\n---\n"), []);
  assert.throws(() => readTopics("x", "no frontmatter"), /expected YAML frontmatter/);
});

test("a skill gets the conventions and its topics, each marked as generated", () => {
  withFixture((root) => {
    assert.equal(buildSettings(root).count, 3);
    assert.equal(
      read(root, "skills/end-session/settings/workspace.md"),
      "<!-- Generated from settings/workspace.md in jwh3times/skills by scripts/build-settings.mjs; edit it there. -->\n# Topic: workspace\n",
    );
    assert.ok(existsSync(path.join(root, "skills/end-session/settings/README.md")));
    assert.ok(!existsSync(path.join(root, "skills/plain/settings")));
    assert.deepEqual(buildSettings(root, { check: true }).stale, []);
  });
});

test("--check reports stale, missing and orphaned copies without writing; a build fixes them", () => {
  withFixture((root) => {
    buildSettings(root);
    write(root, "settings/docs.md", "# Topic: docs, revised\n");
    rmSync(path.join(root, "skills/end-session/settings/README.md"));
    write(root, "skills/end-session/settings/old.md", "gone\n");

    assert.deepEqual(buildSettings(root, { check: true }).stale, [
      "skills/end-session/settings/README.md (missing)",
      "skills/end-session/settings/docs.md",
      "skills/end-session/settings/old.md (orphaned)",
    ]);
    assert.ok(existsSync(path.join(root, "skills/end-session/settings/old.md")));

    buildSettings(root);
    assert.deepEqual(buildSettings(root, { check: true }).stale, []);
    assert.ok(!existsSync(path.join(root, "skills/end-session/settings/old.md")));
  });
});

test("a topic missing from the catalog is an error", () => {
  withFixture((root) => {
    write(
      root,
      "skills/plain/SKILL.md",
      "---\nname: plain\ndescription: x\nmetadata:\n  settings: nowhere\n---\n",
    );
    assert.throws(() => buildSettings(root), /settings topic 'nowhere.md' has no settings\/nowhere\.md/);
  });
});
