#!/usr/bin/env node
// This repository installs its own skills, so the handoff and lets-go workflow runs here too. The
// install is `npx skills@1.7.4 add ./ -s <name> -a codex --copy -y`, which copies skills/<name> verbatim
// into .agents/skills/<name> and records it in skills-lock.json with source ".". After an edit to
// skills/, this script refreshes those copies the same way, so they never drift:
//
//   node scripts/self-install.mjs          # recopy every locally installed skill
//   node scripts/self-install.mjs --check  # verify only; exit 1 if a copy is stale
//
// Run node scripts/sync-agents.mjs afterwards to regenerate .claude/skills/.

import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");

// Names of the skills skills-lock.json records as installed from this checkout.
export function localSkills(root) {
  const lockPath = path.join(root, "skills-lock.json");
  if (!existsSync(lockPath)) return [];
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  return Object.entries(lock.skills ?? {})
    .filter(([, entry]) => entry.sourceType === "local" && entry.source === ".")
    .map(([name]) => name)
    .sort();
}

function listTree(root, dir) {
  const files = [];
  const walk = (rel) => {
    for (const entry of readdirSync(path.join(root, dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child);
      else files.push(child);
    }
  };
  if (existsSync(path.join(root, dir))) walk("");
  return files.sort();
}

// Paths under .agents/skills/<name>/ that differ from skills/<name>/, as "<path> (<why>)".
export function compare(root, name) {
  const source = `skills/${name}`;
  const target = `.agents/skills/${name}`;
  if (!existsSync(path.join(root, source))) return [`${source} (missing source)`];
  const sourceFiles = listTree(root, source);
  const targetFiles = new Set(listTree(root, target));
  const stale = [];
  for (const file of sourceFiles) {
    if (!targetFiles.delete(file)) stale.push(`${target}/${file} (missing)`);
    else if (
      !readFileSync(path.join(root, source, file)).equals(
        readFileSync(path.join(root, target, file)),
      )
    ) {
      stale.push(`${target}/${file}`);
    }
  }
  for (const file of targetFiles) stale.push(`${target}/${file} (orphaned)`);
  return stale;
}

export function selfInstall(root = defaultRoot, { check = false } = {}) {
  const names = localSkills(root);
  const stale = names.flatMap((name) => compare(root, name));
  if (!check) {
    for (const name of names) {
      if (compare(root, name).length === 0) continue;
      const target = path.join(root, ".agents", "skills", name);
      rmSync(target, { recursive: true, force: true });
      cpSync(path.join(root, "skills", name), target, { recursive: true });
    }
  }
  return { names, stale };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const check = process.argv.includes("--check");
    const { names, stale } = selfInstall(defaultRoot, { check });
    if (!check) {
      console.log(`Installed ${names.length} skill(s) from skills/ into .agents/skills/.`);
    } else if (stale.length === 0) {
      console.log(`All ${names.length} self-installed skill(s) match skills/.`);
    } else {
      console.error("Self-installed skills are out of date:");
      for (const file of stale) console.error(`  ${file}`);
      console.error("\nRun 'npm run build' and commit the result.");
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`self-install: ${error.message}`);
    process.exitCode = 1;
  }
}
