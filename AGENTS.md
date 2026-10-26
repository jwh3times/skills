# skills

Source for the agent skills published as `jwh3times/skills` and installed into the consumer
repositories under `~/dev/`: apexracers, caitlyn-holland-vip, causet, guardiantracker, holland-vip,
leasebook, magic-agenda, Nearcited, PressGolf, valleys-at-ashebrook-hoa. `docs/design.md` is the
architecture; read it before changing how a skill is structured, configured, or installed.

## Skill bodies

- A skill body is identical in every repository it lands in, so `npx skills update` delivers fixes
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
