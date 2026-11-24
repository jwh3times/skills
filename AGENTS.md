# skills

Source for the agent skills published as `jwh3times/skills` and installed into the consumer
repositories under `~/dev/`: apexracers, caitlyn-holland-vip, causet, guardiantracker, holland-vip,
hopover, leasebook, magic-agenda, Nearcited, PressGolf, speed-of-light, TirelessInvest,
valleys-at-ashebrook-hoa. A new consumer joins this list, `consumers.json` and the Status line of
`docs/design.md`.
`docs/design.md` is the architecture; read it before changing how a skill is structured,
configured, or installed.

## Skill bodies

- A skill body is identical in every repository it lands in, so re-running the install delivers fixes
  everywhere. Repo-specific behavior is read at run time from that repository's
  `docs/agents/<topic>.md` settings files; machine-specific behavior from the machine config. When
  a skill needs a fact about its repository, add a setting and teach the skill's first-run step to
  propose it.
- Bodies run under both Claude Code and Codex: tool-neutral wording, and paths written as plain
  repo-root-relative text (`docs/agents/open-pr.md`). Installed copies are mirrored into
  `.claude/skills/`, where relative Markdown links break.
- Shell snippets in a `SKILL.md` use named variables (`"$branch"`, `${1:-default}`). Claude Code
  replaces a bare `$0`–`$9` in a loaded `SKILL.md` with the invocation's argument words
  (apexracers#451).

## Layout

- `skills/<name>/` is what installs. Its `settings/` folder is generated from the catalog in
  `settings/` (topics named under `metadata: settings:` in the skill's frontmatter): edit
  `settings/`, then `npm run build`. `settings/agents-md.md` is the shared text
  `scripts/sync-agents.mjs` writes into consumers' `AGENTS.md`; this repository takes none of it.
- This repository installs its own skills: `.agents/skills/` holds copies of `skills/`, and
  `.claude/skills/` mirrors those. Edit only `skills/`; `npm run build` refreshes both. Its own
  settings are in `docs/agents/`.
- `scripts/sync-agents.mjs`, `lint-agent-neutrality.mjs`, `sync-main.mjs`, `next-version.mjs`,
  `check-changelog.mjs`, `stamp-changelog.mjs`, `check-docs.mjs`, `check-skills.mjs` and
  `guard.mjs` are the canonical copies of the scripts the consumer repositories carry, each with
  its test. Fix them here first; consumers take the new copy. A new one also joins the lists at
  the top of `scripts/consumer-drift.mjs`, which the drift report and `consumer-sync.mjs` read.
  The other scripts (`build-settings`, `self-install`, `consumer-drift`, `consumer-sync`) run only
  here.
- `scripts/guard.mjs` is a Claude Code hook (Decision 13 in `docs/design.md`), registered in
  `.claude/settings.json` by `sync-agents.mjs`, which writes only its two entries there. It runs in
  this repository too, so an edit to `.claude/skills/` or `.agents/skills/` is denied: edit
  `skills/` and run `npm run build`.
- `settings/agents-md.md` also holds the `mattpocock/skills` snapshot every consumer installs: its
  commit and skill list are in the `shared-skills` block's install command.
- A skill's helper script (`skills/handoff/handoff-map.mjs`, `skills/end-session/board.mjs`,
  `skills/land/land.mjs`, `skills/dependabot/dependabot.mjs`, `skills/test-prover/mutate.mjs`)
  lives in its skill's folder and installs with it, unlike the scripts above; its test sits in
  `scripts/` so the test does not install.
- `test-prover` and `ci-triage` run in a forked subagent (`context: fork` in their frontmatter),
  and every forked skill and agent file takes `model: inherit`, never a pinned model (Decision 14
  in `docs/design.md`). A session that launches a subagent passes no model override either: the
  subagent runs on the model that launched it. Their bodies still say what to do where the harness
  cannot fork (Codex): follow them inline.
- A skill derived from someone else's keeps their license notice inside its own folder (as
  `skills/handoff/LICENSE`), since the folder installs without the rest of this repository.
- `npm run check` (CI runs it) must pass before a commit. CI also runs
  `git diff --check "$(git mktree </dev/null)" HEAD`, the whitespace rule the strictest consumer
  enforces on every file it copies from here, so no trailing space or blank line at a file's end.

## Consumer repositories

Read-only sources: ask before editing any repository other than this one. Read each skill from
`~/dev/<repo>/.agents/skills/` (authored); `.claude/skills/` there is a generated mirror.
apexracers is the most maintained baseline.

Every merge here leaves the consumers behind until each takes it. The Consumers workflow
(`.github/workflows/consumers.yml`) runs `scripts/consumer-drift.mjs` after each push to `main` and
daily, and keeps the open `consumer-drift` issue listing who is behind on what. For a consumer
marked `sync: true` in `consumers.json` (those on `Scheme: stamp-on-tag`), it also runs
`scripts/consumer-sync.mjs` there and opens a `chore/take-skills` pull request through the release
GitHub App. The others are refreshed by hand the same way: `node scripts/consumer-sync.mjs
<consumer-checkout>`, then run `open-pr` on that branch. Run `node scripts/consumer-drift.mjs` to
see the report locally.

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
