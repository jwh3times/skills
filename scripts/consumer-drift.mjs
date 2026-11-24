#!/usr/bin/env node
// Reports which consumer repositories are behind this repository's main. A consumer is behind when
// a shared skill it installs from here, or a canonical script it carries, differs from the copy
// here, or when its lock pins an older third-party snapshot than the shared install commands name.
// `check-skills.mjs` in each consumer only proves the consumer matches its own lock, so without this
// every merge here leaves the consumers behind, silently.
//
//   node scripts/consumer-drift.mjs                      # print the report as Markdown
//   node scripts/consumer-drift.mjs --json <file>        # also write the result as JSON
//   node scripts/consumer-drift.mjs --markdown <file>    # write the report to a file instead
//   node scripts/consumer-drift.mjs --check              # exit 1 if any consumer is behind
//
// The consumers are listed in `consumers.json`; `sync: true` marks one the Consumers workflow keeps
// current with pull requests (`scripts/consumer-sync.mjs`). Their files are read through the GitHub
// API (`GH_TOKEN` or `GITHUB_TOKEN` when set), and compared by git object id: a skill by its folder's
// tree, a script by its blob. The lock's `commit` field moves on every install, so it is never
// compared; only content is.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");

export const OWN_SOURCE = "jwh3times/skills";
export const BLOCK_FILE = "settings/agents-md.md";
// Every consumer carries these; the optional ones only where its release scheme uses them.
export const ALWAYS_SCRIPTS = ["sync-agents", "lint-agent-neutrality", "check-docs", "check-skills", "guard"];
export const OPTIONAL_SCRIPTS = ["sync-main", "next-version", "check-changelog", "stamp-changelog"];
export const SCRIPT_SUFFIXES = [".mjs", ".test.mjs"];

// Parses every `npx skills add` command in the shared block text, joining `\` continuations.
export function parseInstallCommands(text) {
  const joined = text.replace(/\r\n/g, "\n").replace(/\\\n\s*/g, " ");
  const commands = [];
  for (const line of joined.split("\n")) {
    const match = /^\s*npx (skills add \S+.*)$/.exec(line);
    if (!match) continue;
    const args = match[1].trim().split(/\s+/);
    const [source, ref = null] = args[2].split("#");
    const skills = [];
    for (let i = 3; i < args.length; i += 1) if (args[i] === "-s") skills.push(args[i + 1]);
    commands.push({ source, ref, skills, args });
  }
  return commands;
}

export function scriptFiles() {
  return [...ALWAYS_SCRIPTS, ...OPTIONAL_SCRIPTS].flatMap((base) =>
    SCRIPT_SUFFIXES.map((suffix) => `${base}${suffix}`),
  );
}

function runGit(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

// What a current consumer holds, read from this checkout's HEAD.
export function upstreamState(root = defaultRoot, git = runGit) {
  const commands = parseInstallCommands(readFileSync(path.join(root, BLOCK_FILE), "utf8"));
  const own = commands.find((command) => command.source === OWN_SOURCE);
  if (!own) throw new Error(`${BLOCK_FILE} has no \`npx skills add ${OWN_SOURCE}\` command.`);
  const skills = {};
  for (const name of own.skills) skills[name] = git(root, ["rev-parse", `HEAD:skills/${name}`]);
  const scripts = {};
  for (const file of scriptFiles()) scripts[file] = git(root, ["rev-parse", `HEAD:scripts/${file}`]);
  const snapshots = commands
    .filter((command) => command.source !== OWN_SOURCE)
    .map(({ source, ref, skills: names }) => ({ source, ref, skills: names }));
  return { head: git(root, ["rev-parse", "HEAD"]), skills, scripts, snapshots };
}

// The longest suffix first, so `guard.test.mjs` is `guard`, not `guard.test`.
const baseOf = (file) => {
  const suffix = SCRIPT_SUFFIXES.toSorted((a, b) => b.length - a.length).find((s) => file.endsWith(s));
  return suffix ? file.slice(0, -suffix.length) : file;
};

// Lists what a consumer is behind on. `consumer` holds `skills` (folder name to tree id), `scripts`
// (file name to blob id) and `lock` (the parsed skills-lock.json, or null).
export function compareConsumer(upstream, consumer) {
  const items = [];
  for (const [name, id] of Object.entries(upstream.skills)) {
    const have = consumer.skills[name];
    if (!have) items.push({ kind: "skill", name, state: "missing" });
    else if (have !== id) items.push({ kind: "skill", name, state: "stale", have });
  }
  for (const [file, id] of Object.entries(upstream.scripts)) {
    if (!id) continue;
    const have = consumer.scripts[file];
    if (!have) {
      if (ALWAYS_SCRIPTS.includes(baseOf(file))) items.push({ kind: "script", name: file, state: "missing" });
    } else if (have !== id) items.push({ kind: "script", name: file, state: "stale", have });
  }
  for (const snapshot of upstream.snapshots) {
    const off = snapshot.skills.filter((name) => {
      const entry = consumer.lock?.skills?.[name];
      return !entry || entry.source !== snapshot.source || (snapshot.ref && entry.ref !== snapshot.ref);
    });
    if (off.length > 0) {
      items.push({ kind: "snapshot", name: snapshot.source, state: "stale", count: off.length });
    }
  }
  return items;
}

// The commit date of the newest upstream version a consumer's stale copy equals, or null.
export function versionDate(root, relPath, id, git = runGit) {
  const log = git(root, ["log", "--format=%H %cs", "-n", "300", "HEAD", "--", relPath]);
  for (const line of log ? log.split("\n") : []) {
    const [sha, date] = line.split(" ");
    if (git(root, ["rev-parse", `${sha}:${relPath}`]) === id) return date;
  }
  return null;
}

// Reads a consumer's installed skills, scripts and lock from its main branch.
export async function fetchConsumer(repo, { token, fetchImpl = globalThis.fetch } = {}) {
  const get = async (rel, raw = false) => {
    const headers = {
      Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "User-Agent": "consumer-drift",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/contents/${rel}?ref=main`, { headers });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GET ${repo}/${rel}: HTTP ${response.status}`);
    return raw ? response.text() : response.json();
  };
  const ids = (entries, type) =>
    Object.fromEntries((Array.isArray(entries) ? entries : []).filter((e) => e.type === type).map((e) => [e.name, e.sha]));
  const [skillDirs, scriptEntries, lockText] = await Promise.all([
    get(".agents/skills"),
    get("scripts"),
    get("skills-lock.json", true),
  ]);
  return { skills: ids(skillDirs, "dir"), scripts: ids(scriptEntries, "file"), lock: lockText ? JSON.parse(lockText) : null };
}

function describe(item, dateOf) {
  const name = item.kind === "snapshot" ? `${item.name} snapshot` : `\`${item.name}\``;
  if (item.state === "missing") return `${name} (missing)`;
  if (item.kind === "snapshot") return `${name} (${item.count} skill${item.count === 1 ? "" : "s"} off the pinned commit)`;
  const date = dateOf(item);
  return date ? `${name} (has the ${date} version)` : `${name} (differs from every recent version)`;
}

export function renderMarkdown({ head, results }, dateOf = () => null) {
  const behind = results.filter((r) => r.items?.length > 0);
  const failed = results.filter((r) => r.error);
  const current = results.filter((r) => !r.error && r.items.length === 0);
  const lines = [
    `Consumers behind \`${OWN_SOURCE}\` at ${head ? head.slice(0, 7) : "HEAD"}. The Consumers workflow`,
    "rewrites this report after every push to `main` and daily, and closes the issue once every",
    "consumer is current.",
    "",
  ];
  if (behind.length > 0) {
    lines.push("| Consumer | Behind on | Update |", "| --- | --- | --- |");
    for (const r of behind) {
      const what = r.items.map((item) => describe(item, (i) => dateOf(r, i))).join(", ");
      lines.push(`| ${r.repo} | ${what} | ${r.sync ? "sync PR" : "by hand"} |`);
    }
    lines.push(
      "",
      "By hand: in the consumer, re-run the install commands in its `AGENTS.md` shared-skills block, copy",
      "each canonical script it carries (with its test) from `scripts/` here, run",
      "`node scripts/sync-agents.mjs`, and run `open-pr` on the branch.",
    );
  }
  if (failed.length > 0) {
    lines.push("", "Could not read:", "");
    for (const r of failed) lines.push(`- ${r.repo}: ${r.error}`);
  }
  if (current.length > 0) lines.push("", `Current: ${current.map((r) => r.repo).join(", ")}.`);
  return `${lines.join("\n")}\n`;
}

export async function checkConsumers(root = defaultRoot, { token, fetchImpl, git = runGit } = {}) {
  const upstream = upstreamState(root, git);
  const { consumers } = JSON.parse(readFileSync(path.join(root, "consumers.json"), "utf8"));
  const results = [];
  for (const { repo, sync = false } of consumers) {
    try {
      const consumer = await fetchConsumer(repo, { token, fetchImpl });
      results.push({ repo, sync, items: compareConsumer(upstream, consumer) });
    } catch (error) {
      results.push({ repo, sync, error: error.message });
    }
  }
  const syncTargets = results
    .filter((r) => r.sync && r.items?.length > 0)
    .map((r) => ({ repo: r.repo, name: r.repo.split("/")[1] }));
  return { head: upstream.head, results, syncTargets };
}

async function main(argv) {
  const option = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : argv[i + 1];
  };
  const root = option("--root") ? path.resolve(option("--root")) : defaultRoot;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || undefined;
  const report = await checkConsumers(root, { token });
  const dateOf = (result, item) => {
    if (item.state !== "stale" || item.kind === "snapshot") return null;
    return versionDate(root, item.kind === "skill" ? `skills/${item.name}` : `scripts/${item.name}`, item.have);
  };
  const markdown = renderMarkdown(report, dateOf);
  if (option("--json")) writeFileSync(option("--json"), `${JSON.stringify(report, null, 2)}\n`);
  if (option("--markdown")) writeFileSync(option("--markdown"), markdown);
  else process.stdout.write(markdown);
  for (const r of report.results.filter((x) => x.error)) console.error(`::warning::${r.repo}: ${r.error}`);
  const behind = report.results.some((r) => r.error || r.items.length > 0);
  if (argv.includes("--check") && behind) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
