# Docs

## Doc map

- `docs/design.md` — the architecture, settings catalog, Decisions, Verified and Unverified, Pilot
  plan, and Found while surveying. **When:** a decision is settled; a setting is added, renamed or
  removed (`settings/`); a `skills` CLI question is tested; the pilot advances (the Status line and
  Pilot plan); a consumer-repository problem turns up.
- `AGENTS.md` — durable rules for working in this repository. **When:** the layout, the build and
  check scripts, or a publishing rule changes.
- `skills/*/SKILL.md` — each skill's contract with the skills that call it (what one passes in, what
  the other returns or owes). **When:** a skill changes what it takes from or hands to another
  skill.
- `skills/handoff/machine-config.md` — how the Handoffs folder reaches a machine. **When:** a
  transport or a key of the machine config changes.
- `settings/*.md` — the settings catalog that installs with each skill. **When:** a setting is added,
  renamed or removed, or a default changes.
- `skills/*/settings/*.md` — copies of `settings/` that `npm run build` generates. `frozen`.
- `docs/agents/*.md` — this repository's own settings. **When:** a setting changes.
- `CLAUDE.md` — `@AGENTS.md` only. **When:** never for operating context.
- `README.md` — what is published and how to install it. **When:** a skill is added to or removed
  from `skills/`, or the install command changes.

## Drift probes

- Published skills: `skills/*/SKILL.md`, against the `README.md` table and install command and the
  `docs/design.md` Status line.
- Scripts: `scripts` in `package.json` and the files in `scripts/`, against `AGENTS.md`.

## Docs validation

`npm run check`
