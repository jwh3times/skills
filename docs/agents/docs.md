# Docs

## Doc map

- `docs/design.md` — the architecture, settings catalog, Decisions, Verified and Unverified, Pilot
  plan, and Found while surveying. **When:** a decision is settled; a setting is added, renamed or
  removed (`settings/`); a `skills` CLI question is tested; the pilot advances (the Status line and
  Pilot plan); a consumer-repository problem turns up.
- `AGENTS.md` — durable rules for working in this repository. **When:** the layout, the build and
  check scripts, or a publishing rule changes; a consumer is added.
- `docs/consumer-traps.md` — traps that hold across several consumers (setting up a consumer's
  CodeQL, ruleset and Dependabot, deployers and the stamp commit, `workflow_run`, rehearsals,
  merges from subagents, cloud routines). **When:** a trap turns up in more than one consumer, or
  one turns out to belong to a single repository.
- `docs/routines/dependabot-review.md` — the scheduled Dependabot review routine's prompt.
  **When:** the routine's prompt changes on claude.ai, or the `dependabot` skill changes what the
  routine must say.
- `skills/*/SKILL.md` — each skill's contract with the skills that call it (what one passes in, what
  the other returns or owes). **When:** a skill changes what it takes from or hands to another
  skill.
- `skills/handoff/machine-config.md` — how the Handoffs folder reaches a machine, and its machine
  label. **When:** a transport, a key or a reader of the machine config changes.
- `skills/dependabot/resolution.md` — how a review reads each ecosystem's lockfile install (peers,
  pnpm's unmet peers, uv, NuGet, Go). **When:** a resolution signal is found to mislead a verdict, or
  an ecosystem is added.
- `settings/*.md` — the settings catalog that installs with each skill. **When:** a setting is added,
  renamed or removed, or a default changes.
- `skills/*/settings/*.md` — copies of `settings/` that `npm run build` generates. `frozen`.
- `.agents/skills/*/**` — installed skills, mirrored to `.claude/skills/`: copies of `skills/`,
  which `npm run build` refreshes, and the `mattpocock/skills` snapshot. `frozen`: edit `skills/`,
  and the snapshot only by moving its pin.
- `docs/agents/*.md` — this repository's own settings. **When:** a setting changes.
- `CLAUDE.md` — `@AGENTS.md` only. **When:** never for operating context.
- `README.md` — what is published, how to install it, and the scripts a repository copies. **When:**
  a skill is added to or removed from `skills/`, an install command changes, or a canonical script is
  added or removed.

## Drift probes

- Published skills: `skills/*/SKILL.md`, against the `README.md` table and install command and the
  `docs/design.md` Status line.
- Scripts: `scripts` in `package.json` and the files in `scripts/`, against `AGENTS.md`, the
  `README.md` script table, the `shared-skills` block in `settings/agents-md.md`, and the list of
  shared scripts under Architecture in `docs/design.md`.
- The `mattpocock/skills` snapshot: the install command in the `shared-skills` block, against the
  version in that block and the commit and skill count in Wave 5 of `docs/design.md`.

## Docs validation

`npm run check`
