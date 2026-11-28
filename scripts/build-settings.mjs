#!/usr/bin/env node
// Copies the settings catalog into each skill that reads it, so an installed skill carries the
// definitions its first-run step needs. A skill names its topics in its SKILL.md frontmatter:
//
//   metadata:
//     settings: workspace issue-tracker
//
// and gets settings/README.md plus settings/<topic>.md for each, under skills/<name>/settings/.
// The copies are generated: edit settings/, never skills/<name>/settings/.
//
// A skill that runs another skill's helper script names it the same way, as <skill>/<file>:
//
//   metadata:
//     helpers: end-session/board.mjs
//
// and gets skills/<name>/<file>, the source with a generated-file comment after its shebang, so it
// never depends on the other skill being installed. Edit the source, never a copy. A skill's
// SKILL.md and settings copies may call a named helper only by its own folder
// (.agents/skills/<name>/<file>, or .agents/skills/<skill>/<file> in shared settings text), and
// only when it names that helper or holds its source; anything else fails the build.
//
//   node scripts/build-settings.mjs          # rewrite the copies
//   node scripts/build-settings.mjs --check  # verify only; exit 1 if anything is stale

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");

const catalogDir = "settings";
const skillsDir = "skills";
const conventionsFile = "README.md";

function normalizeNewlines(value) {
  return value.replaceAll("\r\n", "\n");
}

// The words listed under `metadata: <key>:` in a SKILL.md, or [] when it lists none.
function readMetadataList(skillFile, raw, key) {
  const match = normalizeNewlines(raw).match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error(`${skillFile}: expected YAML frontmatter delimited by '---'`);
  const metadata = match[1].match(/^metadata:\n((?:[ \t]+.*\n?)*)/m);
  const value = metadata?.[1].match(new RegExp(`^[ \\t]+${key}:[ \\t]*(.*)$`, "m"));
  return value ? value[1].trim().split(/\s+/).filter(Boolean) : [];
}

// The topics listed under `metadata: settings:` in a SKILL.md.
export function readTopics(skillFile, raw) {
  return readMetadataList(skillFile, raw, "settings");
}

// The helpers listed under `metadata: helpers:` in a SKILL.md, each `<source skill>/<file>`.
export function readHelpers(skillFile, raw) {
  return readMetadataList(skillFile, raw, "helpers");
}

function banner(file) {
  return `<!-- Generated from ${catalogDir}/${file} in jwh3times/skills by scripts/build-settings.mjs; edit it there. -->\n`;
}

// A helper's copy: the source with a generated-file comment, after the shebang when it has one.
function helperCopy(sourceRel, content) {
  const marker = `// Generated from ${sourceRel} in jwh3times/skills by scripts/build-settings.mjs; edit it there.\n`;
  const shebang = content.match(/^#!.*\n/);
  return shebang
    ? shebang[0] + marker + content.slice(shebang[0].length)
    : marker + content;
}

// Whether a file is a helper copy this build wrote: its first line after any shebang is the marker.
function isHelperCopy(content) {
  return /^(?:#!.*\n)?\/\/ Generated from skills\/\S+ in jwh3times\/skills by scripts\/build-settings\.mjs; edit it there\.\n/.test(
    normalizeNewlines(content),
  );
}

// Map of generated path -> content: each skill's settings copies and helper copies. Throws when a
// skill names a topic or helper with no source, when a copy would replace a file the build did not
// write, or when a skill calls a helper through anything but its own copy (checkHelperCalls).
export function buildCopies(root = defaultRoot) {
  const copies = new Map();
  const skills = [];
  const skillsPath = path.join(root, skillsDir);
  if (!existsSync(skillsPath)) return copies;

  for (const entry of readdirSync(skillsPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = `${skillsDir}/${entry.name}/SKILL.md`;
    if (!existsSync(path.join(root, skillFile))) continue;
    const raw = readFileSync(path.join(root, skillFile), "utf8");
    const helpers = readHelpers(skillFile, raw);
    skills.push({ name: entry.name, skillFile, body: raw, helpers });

    for (const helper of helpers) {
      const sourceRel = `${skillsDir}/${helper}`;
      if (!/^[^/]+\/[^/]+$/.test(helper) || !existsSync(path.join(root, sourceRel))) {
        throw new Error(`${skillFile}: helper '${helper}' has no ${sourceRel}`);
      }
      const target = `${skillsDir}/${entry.name}/${path.posix.basename(helper)}`;
      const existing = path.join(root, target);
      if (copies.has(target)) {
        throw new Error(`${skillFile}: two helpers would both be copied to ${target}`);
      }
      if (existsSync(existing) && !isHelperCopy(readFileSync(existing, "utf8"))) {
        throw new Error(`${skillFile}: helper '${helper}' would overwrite ${target}, which the build did not write`);
      }
      copies.set(target, helperCopy(sourceRel, normalizeNewlines(readFileSync(path.join(root, sourceRel), "utf8"))));
    }

    const topics = readTopics(skillFile, raw);
    if (topics.length === 0) continue;

    for (const file of [conventionsFile, ...topics.map((topic) => `${topic}.md`)]) {
      const source = path.join(root, catalogDir, file);
      if (!existsSync(source)) {
        throw new Error(`${skillFile}: settings topic '${file}' has no ${catalogDir}/${file}`);
      }
      copies.set(
        `${skillsDir}/${entry.name}/settings/${file}`,
        banner(file) + normalizeNewlines(readFileSync(source, "utf8")),
      );
    }
  }

  checkHelperCalls(skills, copies);
  return copies;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A skill calls a named helper only through its own folder: `.agents/skills/<its name>/<file>` in
// its SKILL.md or settings copies, or `.agents/skills/<skill>/<file>` in settings copies, whose
// shared text names no skill. The call needs a copy behind it (or the skill holds the source).
// Anything else is an error: that skill would depend on another being installed beside it.
function checkHelperCalls(skills, copies) {
  const sources = [...new Set(skills.flatMap((skill) => skill.helpers))].map((helper) => ({
    helper,
    file: path.posix.basename(helper),
  }));
  const texts = skills.map((skill) => ({ skill, file: skill.skillFile, content: skill.body, shared: false }));
  for (const [target, content] of copies) {
    const name = target.match(/^skills\/([^/]+)\/settings\//)?.[1];
    const skill = skills.find((candidate) => candidate.name === name);
    if (skill) texts.push({ skill, file: target, content, shared: true });
  }

  const problems = [];
  for (const { skill, file, content, shared } of texts) {
    for (const source of sources) {
      const pattern = new RegExp(`\\.(?:agents|claude)/skills/([^/\\s\`'"]+)/${escapeRegExp(source.file)}`, "g");
      for (const [call, folder] of content.matchAll(pattern)) {
        const ownFolder = folder === skill.name || (shared && folder === "<skill>");
        const backed = source.helper === `${skill.name}/${source.file}` || skill.helpers.includes(source.helper);
        if (!ownFolder) {
          problems.push(`${file}: calls ${call}; call this skill's own copy, .agents/skills/${skill.name}/${source.file}`);
        } else if (!backed) {
          problems.push(`${file}: calls ${call}, but ${skill.skillFile} names no helper ${source.helper}`);
        }
      }
    }
  }
  if (problems.length > 0) throw new Error([...new Set(problems)].join("\n"));
}

// Generated files nothing produces any more: anything under a skills/<name>/settings/ the catalog
// does not, and a helper copy (a file carrying the marker) in a skill that no longer names it.
function findOrphans(root, copies) {
  const orphans = [];
  const skillsPath = path.join(root, skillsDir);
  if (!existsSync(skillsPath)) return orphans;
  for (const entry of readdirSync(skillsPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillDir = `${skillsDir}/${entry.name}`;
    for (const file of readdirSync(path.join(root, skillDir), { withFileTypes: true })) {
      const rel = `${skillDir}/${file.name}`;
      if (!file.isFile() || copies.has(rel)) continue;
      if (isHelperCopy(readFileSync(path.join(root, rel), "utf8"))) orphans.push(rel);
    }
    const dir = `${skillDir}/settings`;
    if (!existsSync(path.join(root, dir))) continue;
    for (const file of readdirSync(path.join(root, dir))) {
      if (!copies.has(`${dir}/${file}`)) orphans.push(`${dir}/${file}`);
    }
  }
  return orphans.sort();
}

export function buildSettings(root = defaultRoot, { check = false } = {}) {
  const copies = buildCopies(root);
  const stale = [];

  for (const [target, content] of copies) {
    const absolute = path.join(root, target);
    const exists = existsSync(absolute);
    if (exists && normalizeNewlines(readFileSync(absolute, "utf8")) === content) continue;
    if (check) {
      stale.push(exists ? target : `${target} (missing)`);
      continue;
    }
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }

  for (const orphan of findOrphans(root, copies)) {
    if (check) stale.push(`${orphan} (orphaned)`);
    else rmSync(path.join(root, orphan), { recursive: true, force: true });
  }

  return { stale, count: copies.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const check = process.argv.includes("--check");
    const { stale, count } = buildSettings(defaultRoot, { check });
    if (!check) {
      console.log(`Wrote ${count} settings and helper file(s) into skills.`);
    } else if (stale.length === 0) {
      console.log(`All ${count} settings and helper file(s) match their sources.`);
    } else {
      console.error("Generated settings or helper copies are out of date:");
      for (const file of stale) console.error(`  ${file}`);
      console.error("\nRun 'node scripts/build-settings.mjs' and commit the result.");
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`build-settings: ${error.message}`);
    process.exitCode = 1;
  }
}
