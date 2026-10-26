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

// The topics listed under `metadata: settings:` in a SKILL.md, or [] when it lists none.
export function readTopics(skillFile, raw) {
  const match = normalizeNewlines(raw).match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error(`${skillFile}: expected YAML frontmatter delimited by '---'`);
  const metadata = match[1].match(/^metadata:\n((?:[ \t]+.*\n?)*)/m);
  const settings = metadata?.[1].match(/^[ \t]+settings:[ \t]*(.*)$/m);
  return settings ? settings[1].trim().split(/\s+/).filter(Boolean) : [];
}

function banner(file) {
  return `<!-- Generated from ${catalogDir}/${file} in jwh3times/skills by scripts/build-settings.mjs; edit it there. -->\n`;
}

// Map of generated path -> content, for every skill that names settings topics.
export function buildCopies(root = defaultRoot) {
  const copies = new Map();
  const skillsPath = path.join(root, skillsDir);
  if (!existsSync(skillsPath)) return copies;

  for (const entry of readdirSync(skillsPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = `${skillsDir}/${entry.name}/SKILL.md`;
    if (!existsSync(path.join(root, skillFile))) continue;
    const topics = readTopics(skillFile, readFileSync(path.join(root, skillFile), "utf8"));
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
  return copies;
}

// Files under any skills/<name>/settings/ that the catalog no longer produces.
function findOrphans(root, copies) {
  const orphans = [];
  const skillsPath = path.join(root, skillsDir);
  if (!existsSync(skillsPath)) return orphans;
  for (const entry of readdirSync(skillsPath, { withFileTypes: true })) {
    const dir = `${skillsDir}/${entry.name}/settings`;
    if (!entry.isDirectory() || !existsSync(path.join(root, dir))) continue;
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
      console.log(`Wrote ${count} settings file(s) into skills.`);
    } else if (stale.length === 0) {
      console.log(`All ${count} settings file(s) match the catalog.`);
    } else {
      console.error("Settings copies are out of date:");
      for (const file of stale) console.error(`  ${file}`);
      console.error("\nRun 'node scripts/build-settings.mjs' and commit the result.");
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`build-settings: ${error.message}`);
    process.exitCode = 1;
  }
}
