#!/usr/bin/env node
// Brings one consumer checkout up to this repository's main: re-runs the shared install commands
// in it, copies each canonical script it carries (with its test) from `scripts/` here, and runs
// its `scripts/sync-agents.mjs` to regenerate the mirrors and the shared AGENTS.md blocks. It
// commits nothing; the Consumers workflow commits and opens the pull request, and the consumer's
// own CI checks the result.
//
//   node scripts/consumer-sync.mjs <consumer-root>             # update the checkout
//   node scripts/consumer-sync.mjs <consumer-root> --dry-run   # print the plan only
//
// The install commands come from this checkout's `settings/agents-md.md`, the block `sync-agents`
// then writes into the consumer, so the consumer ends with the commands it was installed by.
//
// A skill renamed here leaves its old copy and lock entry in the consumer, which `check-skills`
// then fails on, so a retired skill is removed first and the settings file renamed with it moves.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALWAYS_SCRIPTS,
  BLOCK_FILE,
  OPTIONAL_SCRIPTS,
  OWN_SOURCE,
  SCRIPT_SUFFIXES,
  parseInstallCommands,
} from "./consumer-drift.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");

// Skills this repository no longer publishes, by the name that replaced them, and the settings
// files renamed with them (Decision 15 in `docs/design.md`).
export const RETIRED_SKILLS = { ship: "open-pr" };
export const RENAMED_SETTINGS = { "docs/agents/ship.md": "docs/agents/open-pr.md" };

// A retired skill the consumer's lock still holds from here. `skills remove` takes no `-a`: with
// `-a codex` the CLI (1.9.0) reports the removal and changes nothing.
export function planRemovals(consumerRoot) {
  const lockPath = path.join(consumerRoot, "skills-lock.json");
  if (!existsSync(lockPath)) return [];
  const locked = JSON.parse(readFileSync(lockPath, "utf8")).skills ?? {};
  return Object.keys(RETIRED_SKILLS)
    .filter((name) => locked[name]?.source === OWN_SOURCE)
    .map((name) => ["npx", ["skills", "remove", name, "-y"]]);
}

// A renamed settings file still at its old path, unless the new one already exists.
export function planMoves(consumerRoot) {
  return Object.entries(RENAMED_SETTINGS).filter(
    ([from, to]) => existsSync(path.join(consumerRoot, from)) && !existsSync(path.join(consumerRoot, to)),
  );
}

// The script files to copy: every always-carried script, and an optional one only where the
// consumer already has it (a release scheme that does not use it never gets it).
export function planScripts(consumerRoot, upstreamRoot = defaultRoot) {
  const bases = [
    ...ALWAYS_SCRIPTS,
    ...OPTIONAL_SCRIPTS.filter((base) => existsSync(path.join(consumerRoot, "scripts", `${base}.mjs`))),
  ];
  return bases
    .flatMap((base) => SCRIPT_SUFFIXES.map((suffix) => `${base}${suffix}`))
    .filter((file) => existsSync(path.join(upstreamRoot, "scripts", file)));
}

export function planCommands(upstreamRoot = defaultRoot) {
  const commands = parseInstallCommands(readFileSync(path.join(upstreamRoot, BLOCK_FILE), "utf8"));
  if (commands.length === 0) throw new Error(`${BLOCK_FILE} has no \`npx skills add\` command.`);
  return [
    ...commands.map((command) => ["npx", command.args]),
    ["node", ["scripts/sync-agents.mjs"]],
  ];
}

function runCommand(command, args, cwd) {
  // npx is a .cmd shim on Windows, which Node only spawns through a shell; the arguments come from
  // the shared block and hold no spaces or shell syntax.
  const result =
    process.platform === "win32"
      ? spawnSync([command, ...args].join(" "), { cwd, stdio: "inherit", shell: true })
      : spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
}

export function syncConsumer(consumerRoot, { upstreamRoot = defaultRoot, run = runCommand, dryRun = false } = {}) {
  if (!existsSync(path.join(consumerRoot, "scripts", "sync-agents.mjs"))) {
    throw new Error(`${consumerRoot} has no scripts/sync-agents.mjs; is it a consumer checkout?`);
  }
  const removals = planRemovals(consumerRoot);
  const moves = planMoves(consumerRoot);
  const commands = planCommands(upstreamRoot);
  const scripts = planScripts(consumerRoot, upstreamRoot);
  if (!dryRun) {
    for (const [command, args] of removals) run(command, args, consumerRoot);
    for (const [from, to] of moves) renameSync(path.join(consumerRoot, from), path.join(consumerRoot, to));
    // Installs first, then the scripts, so sync-agents runs as its newest copy.
    for (const [command, args] of commands.slice(0, -1)) run(command, args, consumerRoot);
    for (const file of scripts) {
      copyFileSync(path.join(upstreamRoot, "scripts", file), path.join(consumerRoot, "scripts", file));
    }
    const [command, args] = commands.at(-1);
    run(command, args, consumerRoot);
  }
  return { removals, moves, commands, scripts };
}

function main(argv) {
  const target = argv.find((arg) => !arg.startsWith("--"));
  if (!target) {
    console.error("usage: node scripts/consumer-sync.mjs <consumer-root> [--dry-run]");
    process.exitCode = 2;
    return;
  }
  const { removals, moves, commands, scripts } = syncConsumer(path.resolve(target), {
    dryRun: argv.includes("--dry-run"),
  });
  for (const [command, args] of removals) console.log(`run   ${command} ${args.join(" ")}`);
  for (const [from, to] of moves) console.log(`move  ${from} -> ${to}`);
  for (const [command, args] of commands) console.log(`run   ${command} ${args.join(" ")}`);
  for (const file of scripts) console.log(`copy  scripts/${file}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
