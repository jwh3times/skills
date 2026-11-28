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

const boardSource = "#!/usr/bin/env node\n// Board helper.\nexport const x = 1;\n";
const boardMarker =
  "// Generated from skills/end-session/board.mjs in jwh3times/skills by scripts/build-settings.mjs; edit it there.\n";

function withHelperFixture(fn) {
  withFixture((root) => {
    write(root, "skills/end-session/board.mjs", boardSource);
    write(
      root,
      "skills/land/SKILL.md",
      "---\nname: land\ndescription: Land.\nmetadata:\n  helpers: end-session/board.mjs\n---\n\nRun `node .agents/skills/land/board.mjs set`.\n",
    );
    fn(root);
  });
}

test("a skill that names a helper gets a copy, marked as generated after the shebang", () => {
  withHelperFixture((root) => {
    buildSettings(root);
    assert.equal(
      read(root, "skills/land/board.mjs"),
      "#!/usr/bin/env node\n" + boardMarker + "// Board helper.\nexport const x = 1;\n",
    );
    assert.equal(read(root, "skills/end-session/board.mjs"), boardSource);
    assert.deepEqual(buildSettings(root, { check: true }).stale, []);
  });
});

test("a helper must be <skill>/<file> with a source, and two may not share a copy's path", () => {
  withHelperFixture((root) => {
    buildSettings(root);
    const land = (helpers) =>
      write(
        root,
        "skills/land/SKILL.md",
        `---\nname: land\ndescription: Land.\nmetadata:\n  helpers: ${helpers}\n---\n`,
      );

    land("end-session/settings/docs.md");
    assert.throws(
      () => buildSettings(root),
      /skills\/land\/SKILL\.md: helper 'end-session\/settings\/docs\.md' has no skills\/end-session\/settings\/docs\.md/,
    );

    land("end-session/missing.mjs");
    assert.throws(
      () => buildSettings(root),
      /skills\/land\/SKILL\.md: helper 'end-session\/missing\.mjs' has no skills\/end-session\/missing\.mjs/,
    );

    write(root, "skills/other/board.mjs", "#!/usr/bin/env node\n// Another board.\n");
    land("end-session/board.mjs other/board.mjs");
    assert.throws(
      () => buildSettings(root),
      /skills\/land\/SKILL\.md: two helpers would both be copied to skills\/land\/board\.mjs/,
    );
  });
});

test("a skill's own script that quotes the marker below its first line is still its own", () => {
  withHelperFixture((root) => {
    const own = `#!/usr/bin/env node\n// plain's own board script.\n${boardMarker}`;
    write(root, "skills/plain/board.mjs", own);
    assert.deepEqual(buildSettings(root, { check: true }).stale.filter((s) => s.includes("plain")), []);
    buildSettings(root);
    assert.equal(read(root, "skills/plain/board.mjs"), own);

    write(root, "skills/land/board.mjs", own);
    assert.throws(() => buildSettings(root), /would overwrite skills\/land\/board\.mjs/);
  });
});

test("--check fails on a hand-edited helper copy and on one no skill names any more", () => {
  withHelperFixture((root) => {
    buildSettings(root);
    write(root, "skills/plain/board.mjs", read(root, "skills/land/board.mjs"));
    write(root, "skills/land/board.mjs", read(root, "skills/land/board.mjs") + "// local fix\n");

    assert.deepEqual(buildSettings(root, { check: true }).stale, [
      "skills/land/board.mjs",
      "skills/plain/board.mjs (orphaned)",
    ]);

    buildSettings(root);
    assert.deepEqual(buildSettings(root, { check: true }).stale, []);
    assert.ok(!existsSync(path.join(root, "skills/plain/board.mjs")));
    assert.equal(read(root, "skills/end-session/board.mjs"), boardSource);
  });
});

test("a skill's own script of the same name is never taken for an orphan, and the last copy still is", () => {
  withHelperFixture((root) => {
    buildSettings(root);
    write(root, "skills/plain/board.mjs", "#!/usr/bin/env node\n// plain's own board script.\n");
    write(
      root,
      "skills/land/SKILL.md",
      "---\nname: land\ndescription: Land.\n---\n\nNo board here.\n",
    );

    assert.deepEqual(buildSettings(root, { check: true }).stale, ["skills/land/board.mjs (orphaned)"]);
    buildSettings(root);
    assert.ok(!existsSync(path.join(root, "skills/land/board.mjs")));
    assert.ok(existsSync(path.join(root, "skills/plain/board.mjs")));
  });
});

test("a copy that would overwrite a file the build did not write is an error", () => {
  withHelperFixture((root) => {
    write(root, "skills/land/board.mjs", "#!/usr/bin/env node\n// land's own board script.\n");
    assert.throws(
      () => buildSettings(root),
      /skills\/land\/SKILL\.md: helper 'end-session\/board\.mjs' would overwrite skills\/land\/board\.mjs/,
    );
    assert.equal(read(root, "skills/land/board.mjs"), "#!/usr/bin/env node\n// land's own board script.\n");
  });
});

test("a skill that calls another skill's copy of a helper is an error", () => {
  withHelperFixture((root) => {
    write(
      root,
      "skills/land/SKILL.md",
      "---\nname: land\ndescription: Land.\nmetadata:\n  helpers: end-session/board.mjs\n---\n\nRun `node .agents/skills/end-session/board.mjs set`.\n",
    );
    assert.throws(
      () => buildSettings(root, { check: true }),
      /skills\/land\/SKILL\.md: calls \.agents\/skills\/end-session\/board\.mjs; call this skill's own copy/,
    );
    for (const call of [".claude/skills/end-session/board.mjs", ".agents/skills/<skill>/board.mjs"]) {
      write(
        root,
        "skills/land/SKILL.md",
        `---\nname: land\ndescription: Land.\nmetadata:\n  helpers: end-session/board.mjs\n---\n\nRun \`node ${call} set\`.\n`,
      );
      assert.throws(
        () => buildSettings(root, { check: true }),
        /skills\/land\/SKILL\.md: calls .*board\.mjs; call this skill's own copy/,
        call,
      );
    }
  });
});

test("--check reports a named helper's copy that is missing", () => {
  withHelperFixture((root) => {
    buildSettings(root);
    rmSync(path.join(root, "skills/land/board.mjs"));
    assert.deepEqual(buildSettings(root, { check: true }).stale, ["skills/land/board.mjs (missing)"]);
  });
});

test("a skill whose body or settings call a helper without naming it is an error", () => {
  withHelperFixture((root) => {
    write(
      root,
      "settings/docs.md",
      "# Topic: docs\n\nWrite it with `node .agents/skills/<skill>/board.mjs file`.\n",
    );
    // end-session holds the source, so its copy of the topic may call it.
    assert.doesNotThrow(() => buildSettings(root, { check: true }));
    write(
      root,
      "skills/plain/SKILL.md",
      "---\nname: plain\ndescription: x\nmetadata:\n  settings: docs\n---\n",
    );
    assert.throws(
      () => buildSettings(root, { check: true }),
      /skills\/plain\/settings\/docs\.md: calls \.agents\/skills\/<skill>\/board\.mjs, but skills\/plain\/SKILL\.md names no helper end-session\/board\.mjs/,
    );
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
