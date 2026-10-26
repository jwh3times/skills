# skills

Source for the agent skills published as `jwh3times/skills` and installed into the consumer
repositories under `~/dev/`: apexracers, caitlyn-holland-vip, causet, guardiantracker, holland-vip,
leasebook, magic-agenda, Nearcited, PressGolf, valleys-at-ashebrook-hoa. `docs/design.md` is the
architecture; read it before changing how a skill is structured, configured, or installed.

## Skill bodies

- A skill body is identical in every repository it lands in, so re-running the install delivers fixes
  everywhere. Repo-specific behavior is read at run time from that repository's
  `docs/agents/<topic>.md` settings files; machine-specific behavior from the machine config. When
  a skill needs a fact about its repository, add a setting and teach the skill's first-run step to
  propose it.
- Bodies run under both Claude Code and Codex: tool-neutral wording, and paths written as plain
  repo-root-relative text (`docs/agents/ship.md`). Installed copies are mirrored into
  `.claude/skills/`, where relative Markdown links break.
- Shell snippets in a `SKILL.md` use named variables (`"$branch"`, `${1:-default}`). Claude Code
  replaces a bare `$0`–`$9` in a loaded `SKILL.md` with the invocation's argument words
  (apexracers#451).

## Layout

- `skills/<name>/` is what installs. Its `settings/` folder is generated from the catalog in
  `settings/` (topics named under `metadata: settings:` in the skill's frontmatter): edit
  `settings/`, then `npm run build`.
- This repository installs its own skills: `.agents/skills/` holds copies of `skills/`, and
  `.claude/skills/` mirrors those. Edit only `skills/`; `npm run build` refreshes both. Its own
  settings are in `docs/agents/`.
- `scripts/sync-agents.mjs` and `scripts/lint-agent-neutrality.mjs` are the canonical copies of the
  scripts every consumer repository carries. Fix them here first; consumers take the new copy.
- A skill derived from someone else's keeps their license notice inside its own folder (as
  `skills/handoff/LICENSE`), since the folder installs without the rest of this repository.
- `npm run check` (CI runs it) must pass before a commit.

## Consumer repositories

Read-only sources: ask before editing any repository other than this one. Read each skill from
`~/dev/<repo>/.agents/skills/` (authored); `.claude/skills/` there is a generated mirror.
apexracers is the most maintained baseline.

## Publishing

- Ask before creating any GitHub repository or pushing.
- This repository is public. Describe the consumers' private companion repositories and project
  boards by role, never by name or number: several consumers deliberately keep those out of public
  files.
- Settle the `skills` CLI questions under "Unverified" in `docs/design.md` by running the CLI in a
  scratch directory, and record the result there.

## Decisions

Bring a recommendation for each decision; ask before anything load-bearing.

## On the Fedora machine

- `grep` is `ugrep`; lookahead needs `-P`.
- No Proton Drive sync client: handoffs go through the `proton-drive` CLI with
  `HANDOFFS_DIR=~/dev/handoffs`.
