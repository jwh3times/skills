# Shared skills: design

Status: decided 2026-10-26 (see Decisions); pilot step 1 done; `end-session`, `handoff`, `lets-go`,
`ship` and `docs-updater` written, carrying ApexRacers' fixes through #456, and installed in this
repository and in ApexRacers (pilot step 2, apexracers#458, 2026-10-27), then in causet (#342),
caitlyn-holland-vip (#242), holland-vip (#214) and GuardianTracker (#440), all 2026-10-27, and
PressGolf (#182), Nearcited (#237), LeaseBook (#637), magic-agenda (#556) and
valleys-at-ashebrook-hoa (#477), 2026-10-27/28: every consumer. On 2026-10-28 every consumer
converged on the settings defaults (#16, see Convergence) and took #17.

## Goal

Publish the skills the user wrote — `ship`, `end-session`, `handoff`, `lets-go` and `docs-updater` —
from this one repository, installable into any repository. Installing adapts a skill
to its repository, but **by writing settings, not by editing the skill**: the skill body stays
identical everywhere so fixes flow to every repository by re-running the install (see Install and update).

## Why not edit the skill per repo

That is what exists today, and it does not hold. Across the user's 10 repositories under `~/dev`
there are 41 copies of these skills, every one different. ApexRacers' `ship` and PressGolf's `ship`
differ on more lines than the file has. A fix such as apexracers#451 (bare `$N` in a skill body)
reaches only the repository it was made in. Templated install would recreate this on day one: each
installed copy is a fork, and `skills update` either overwrites the tailoring or cannot apply.

## Architecture

| Layer | Lives in | Owned by | Changes when |
| --- | --- | --- | --- |
| Skill body | `.agents/skills/<name>/**`, installed from this repo | this repo | an update is published |
| Repo settings | `docs/agents/<topic>.md` in each repository | that repository | the repo's conventions change |
| Machine settings | `~/.config/handoffs/config` (or env) | that machine | a machine changes |
| Hooks | named sections inside a repo settings file | that repository | the repo needs a step the skill lacks |

**Settings are grouped by topic, not by skill.** About half the settings are read by three or four
skills — merge style, private companion, board, human follow-ups. One file per skill would repeat
them and drift again. The repositories already use this layout: every one has
`docs/agents/issue-tracker.md` and all but CH have `triage-labels.md` (from the `mattpocock/skills`
setup flow);
magic-agenda has `releases.md`; caitlyn-holland-vip already moved its handoff transport into
`docs/agents/handoffs.md`.

**Each skill configures itself on first run.** The `skills` CLI copies files and (as far as known)
runs nothing at install. So every skill opens with a step 0:

> Read the settings files this skill needs. If one is missing, or lacks a setting this version needs:
> scan the repository (manifests, CI workflows, `CHANGELOG.md`, tag history, recent merged PRs for
> merge style, `private/`), propose values, confirm them with the user, write the file, then continue.

The same step handles upgrades: a new skill version that adds a setting asks for only that one.
When no user can confirm (running as a subagent, or in a non-interactive run), step 0 writes
nothing: it stops and reports the missing settings to its caller. A skill invoked inline by another
(handoff running end-session) still has the user, so it asks.

**Settings format.** A repo settings file is Markdown with one `##` heading per setting, under the
setting's fixed name; step 0 detects a missing setting by its missing heading. Hooks are
`## Hook: <name>` sections listing steps. Helper scripts never read repo settings: the agent reads
them and passes values as arguments (`handoff-map.mjs --key ApexRacers`). The machine config is a
shell-style `KEY=value` file.

**Settings definitions.** This repository keeps one catalog, `settings/<topic>.md`: each setting's
name, kind, meaning, and how step 0 discovers it. A build script copies the topics a skill reads
into `skills/<name>/settings/`, so every installed skill carries the definitions it needs; its
`--check` fails when a copy drifts from the catalog.

**Hooks cover genuinely repo-only steps.** A skill names fixed points ("before fast checks", "after
sync", "extra cleanup"); a repo settings file may list steps under a hook, which the skill runs at
that point. A repository whose workflow differs in kind, not in values, keeps its own skill under its
own name (e.g. `pressgolf-release`) rather than bending the shared one.

**Install and update.**

```bash
# Install, and later update: the same command
npx skills add jwh3times/skills -s end-session -s ship -a codex --copy -y
node scripts/sync-agents.mjs                # regenerate .claude/skills/
```

Claude Code reads project skills only from `.claude/skills/` (2.1.310, tested 2026-10-26), so that
mirror stays. `-a codex` makes the CLI write only `.agents/skills/`, leaving `sync-agents.mjs` the
sole writer of `.claude/skills/`. `npx skills update` is not used: it re-runs `add` for every agent
it detects, which links `.claude/skills/<name>` (see Verified). Re-running `add` is all `update`
does, without the up-to-date check; an unchanged skill rewrites to an identical file.

Every skill installs per project, `handoff`/`lets-go` included: helper scripts keep a fixed
repo-root-relative path (`.agents/skills/handoff/handoff-map.mjs`), cloud sessions get a committed
copy, and each repository keeps one lock file. The CLI installs only skills, so `sync-agents.mjs`
and `lint-agent-neutrality.mjs` are copied by hand; this repository holds their canonical copies
and tests, and fixes land here first.

**This repository installs its own skills**, so `handoff` and `lets-go` work here like anywhere
else: `npx skills@1.7.4 add ./ -s <name> -a codex --copy -y` copies `skills/<name>` verbatim into
`.agents/skills/<name>` and locks it with source `.`. After that, `npm run build` refreshes those
copies (`scripts/self-install.mjs`) and the `.claude/skills/` mirror, and `npm run check` fails when
either drifts. The lock's `computedHash` goes stale on a refresh; nothing reads it, since `update`
is never run.

## Settings catalog

Values come from reading every copy on 2026-10-26. Abbreviations: AR apexracers, CA causet, CH
caitlyn-holland-vip, GT guardiantracker, HV holland-vip, LB leasebook, MA magic-agenda, NC Nearcited,
PG PressGolf, VA valleys-at-ashebrook-hoa. Kind: **value** (command, path, name), **toggle** (a shared
step on or off), **step** (selects one of several implementations), **hook** (repo-only steps).

### `docs/agents/workspace.md` — new; read by every skill

| Setting | Found | Kind |
| --- | --- | --- |
| Merge style | squash: AR, LB. Merge commits: the other 8 (measured from the last 5 merged PRs). Not a setting after all: end-session's one PR-based branch rule serves both (see Fixed in the skill body) | — |
| Private companion | none (CA, PG) or `private/`; repo named in the file (AR, HV, VA) or discovered from the checkout (LB, NC, GT, MA, CH — deliberately keeps the locator out of the public tree) | value |
| Companion status command | `node scripts/repository-status.mjs --check-private` (AR), `git -C private status` (others) | value |
| Companion commit/push policy | report and ask (AR), leave to `/ship` (CH), never without authorization (HV), expected (LB, NC, VA — `commit` with a staged-diff check), gated: diff review + value scan + visibility check + approval (MA) | step |
| Companion bootstrap | `npm run bootstrap:private` (MA, NC, VA) | value |
| Sync with `main` | `npm run sync:main` (AR, CH, HV, LB, VA — LB's fast-forwards `private/` too), plain fast-forward (PG), `cst pull --ff-only` (CA) | value |
| After-sync setup | NC: `pnpm install`, `pnpm local:env`, `pnpm check` | hook |
| Safe-to-remove paths | lists in AR, GT, LB, MA, NC, PG; CH and HV leave artifacts by default | value |
| Never-remove paths | lists in AR, GT, MA, NC, PG, VA, CA | value |
| Dev stack | status/stop commands and banned commands: `docker compose ps` (AR), `dev.ps1 down`, `reset-db` banned (LB), `supabase stop` (NC), `-v` banned (GT) | value |
| Generated-config check | command; always (AR, CA, VA) or only when agent/skill sources changed (CH, LB, PG) | value + toggle |
| Final portability check | `node scripts/repository-status.mjs --check` (AR only) | value |

### `docs/agents/issue-tracker.md` — exists; extend

| Setting | Found |
| --- | --- |
| Public repo slug | `jwh3times/<name>`; GitHub casing differs from the directory (`GuardianTracker`, `LeaseBook`) |
| Private issue repo | named in the public tree (AR, HV, VA); discovered from the checkout (LB, NC, GT, MA, CH); none (CA, PG) |
| Board | owner `jwh3times`, one project per repository except PG; its number is a per-repo setting |
| Board fields and values | AR Status (Todo/In Progress/Blocked/Parked/Done) + Blocked by; HV `Deferred` for Parked; CH, CA Status/Gate/Area; GT Status/Blocked By/Chain/Order/Gate/ADR/Triage; LB Track/Gate + a Status its board's workflows set; MA Phase/Priority/Size/Gate by hand + a Status its board's workflows set (one private board holds both repositories' issues; it auto-adds only public ones); NC Status/Stage/Gate; VA Status/Gate/Area/Next Action/Blocking Item |
| New work | an issue (the shared `end-session`'s behavior before this setting); a board draft item until the work is committed to (GT, ADR 0024) |
| Security findings | draft repository advisory (AR — plus a draft board item — CH, CA, HV); private issue labelled `security` (LB); private doc (GT `security-limitations.md`, MA a private issue plus the register in `private/README.md`, VA tracker + wiki); `SECURITY.md` (PG) |

Labels stay in `triage-labels.md`, or in `issue-tracker.md`'s own section where a repository keeps
them there (CH). Extras beyond the five canonical labels: CA `human-action-required`; LB
`blocked-by-human`, `security`, `product-decision`; NC `bug`/`enhancement`/`documentation`. CH has
no `triage-labels.md`.

### `docs/agents/human-follow-up.md` — exists under four names; normalize

Today: `human-actions.md` (AR), `human-followups.md` (GT), `human-follow-up.md` (MA),
`docs/human-followups.md` (CA), an anchor in `issue-tracker.md` (CH, LB). Read by ship, end-session,
docs-updater.

| Setting | Found |
| --- | --- |
| Issue destination | private companion repo (most), public repo (CA), checkbox in a public tracking issue (NC #17), labelled issue only (PG) |
| Label | `ready-for-human` (LB adds `blocked-by-human` when other work waits on it), `human-action-required` (CA) |
| Wiki | private `human-todo` (AR, CH, GT, LB, MA); `Runbook-<slug>` pages (HV); public wiki (CA); `Human-TODO` with a contact-value scan (VA); none (NC, PG) |
| Wiki push pre-authorized | CH |

### `docs/agents/releases.md` — new everywhere except MA (VA's `ci-and-release.md` overlaps)

As built (`settings/releases.md`, 2026-10-27): `Scheme` is a step setting with three
implementations in the `ship` body — `per-merge` (AR, CH, GT, HV, MA, VA), `cut-on-line` (LB,
whose workflow tags each merge; CA, whose maintainer tags releases by hand), `none` (NC, PG) — and
`Skipped tags` (`backfill` for CH, GT, HV, MA, VA; `roll up` for AR, with an **Ignore** list for
legacy tags) carries the fourth. Extra headings and footer links are not
settings: `ship` uses the headings the file already has and keeps an existing link footer in its
own pattern. The bump always sets an exact `x.y.0` computed from the `origin/main` baseline (VA), so
a re-run cannot advance twice; HV's and MA's relative `npm version minor|major` become that.

| Setting | Found |
| --- | --- |
| Scheme | **rollup-per-merge** (AR); **dated per merge plus backfill of skipped tags** (CH, GT, HV, MA, VA); **accumulate, cut only on a major/minor change** (LB); **none** (NC, PG — ship skips its versioning section) |
| Version file | `web/package.json` (AR), `package.json` (CH, HV, MA, VA), `VERSION` (GT, LB) |
| Bump command | `npm version <x.y.0> --no-git-tag-version` (AR), `npm version <floor>` (CH), `npm version minor\|major` (HV, MA), `npm version <exact> --allow-same-version` (VA), edit `VERSION` (GT, LB) |
| Ask before bumping | always (HV, LB, MA), only when ambiguous (AR, CH, GT, VA) |
| Next-version command | `bash scripts/next-version.sh` (AR, CH, GT, VA), `node scripts/next-version.mjs` (HV, MA), computed in `version.yml` (LB) |
| Legacy tags to ignore | `v1.0.0.x` (CH, HV), `v1.1.1.x` (MA), `v0.1.0.x` and `v0.1.1`–`v0.1.6`, released before the changelog kept a section per build (VA) |
| Unreleased placeholder | `No unreleased changes.` (AR, CH, GT, HV, MA), empty (VA), `- _Nothing yet._` (LB) |
| Extra headings | `Deprecated` (LB); `Internal`, `Docs` (MA) |
| Footer links | compare (AR, GT, MA, VA), release tag on cut (LB), none (CH, HV) |
| Local changelog check | `bash scripts/verify-changelog-version.sh` (AR), `node scripts/check-changelog.mjs` (MA); CH, GT, HV, VA have a script and CI job but ship does not run it |
| Release commit message | `chore(release): prepare v<v>` (AR), `chore: prepare release v<v>` (CH), `docs: update docs and changelog for v<v>` (GT, HV), `docs: changelog and docs for v<v>` (MA), `docs: prepare release v<v>` (VA), `docs: update docs and changelog` (LB), `docs: update docs for <topic>` (PG), plain sentence (NC) |

### `docs/agents/docs.md` — new

As built (2026-10-27, the user's choice): one `Doc map` replaces both `Docs refresh` and
`Session doc routing`. Each document carries what it owns, **when** to update it (the change kinds and paths
that AR's, GT's and NC's trigger matrices list, turned around per document) and an optional marker:
`frozen`, `append-only`, `amend-only`, `owner-only` (NC's `LICENSE`, open product questions),
`ship-owned` (the changelog's sections and the version file) or `pinned` (a document another check
fingerprints, such as AR's hash-pinned privacy matrix source). A **Never in public docs** list holds
NC's and GT's private content kinds. `Drift probes` holds each agent file's "how to detect drift";
`Docs validation` is read by docs-updater too. `ship` always runs `docs-updater`, so PG's inline
list becomes its `Doc map`. `Generated-config check` (workspace) gains the regenerate command.

| Setting | Found |
| --- | --- |
| Refresh method (built as `Docs refresh`; no longer a setting) | `docs-updater` agent (AR, CH, GT, HV, LB, MA, VA; NC reads the agent file when no agent harness exists); `docs-updater` skill (CA); inline doc list (PG) |
| Docs owned | per-repo list given to the refresher |
| Changelog owner during ship | ship (AR, HV, LB declare it); GT, MA, VA's agent claims it, so ship must say to leave it alone |
| Private-doc routing (end-session) | file → when to update; frozen files (AR `archive.md`, LB design history, VA session history); append-only folders (AR captured API responses); amend-only dated docs (MA) |
| Docs validation | `npm run test:docs` (CA); `npm run docs:check` from `web/`, which runs `scripts/check-docs.mjs`, and the companion's `private/scripts/check-docs.mjs` (LB) |

### `docs/agents/ship.md` — ship-only

As built (2026-10-27): `settings/ship.md` holds `Fast checks` and `Issue link`. All 8 repositories
with a `ship` define the same `<type>/<issue#>-<slug>` and `Closes`/`Part of` rule in
`docs/agents/dev-flow.md`, so `Issue link` covers branch naming too. The PR body is not a setting:
`ship` fills the repository's PR template and always adds the `Release level:` line (CH). NC's
trigger table and PG's impact flags go under `Hook: before PR`. LB's and PG's linkage warnings are
in the body, warn-only, using `Board` and `Private issue repository`.

| Setting | Found |
| --- | --- |
| Fast checks | list of {folder, command, optional "only when these paths changed"}; must cover every required check that runs locally. AR: `web/` prettier, lint, build; root `dotnet build`, `npm run sync:agents:check`, `npm run lint:agents` (the required "Verify generated agent config" check, #455). GT adds Go `gofmt`/`go vet`. LB `dotnet format --verify-no-changes`, conditional `api:generate`. NC conditional wrangler dry-run and e2e. PG runs `test:coverage` and a 90% patch-coverage script |
| Branch naming | `agent/<topic>` (CH, GT, HV), `<type>/<topic>` (LB, PG), `<type>/<issue#>-<slug>`, never `release/*` (MA), `<type>/<issue#>-<slug>` (AR, part of `Issue link`) |
| Issue link | AR (#456), and the same rule in every `dev-flow.md`: the body opens with `Closes #N` or `Part of #N`, `N` taken from the branch; `Flow waived by the user: <reason>` for a waiver; no line for dependency bumps, docs-and-agent-config-only changes and release prep. NC: one keyword per issue. VA: slice branches `feat/<spec#>-slice-<n>-<slug>` |
| PR body | template path; extra lines: `Release level:` (CH), `Fixes #NN` (PG), template checklist (AR, NC) |
| Hook: review before PR | NC's trigger table; PG's impact flags feeding the PR body |
| Hook: issue-linkage warnings | LB (board, Track/Gate, private-tracker leak), PG, NC (`Closes #N`) |

### `docs/agents/handoffs.md` — repo part of handoff/lets-go

| Setting | Found |
| --- | --- |
| Map key | hand-chosen (`ApexRacers`, `LeaseBook`, `GuardianTracker`); every script guesses it from the remote name, seven different ways. Make it explicit |
| Extra document content | NC: build-order issue #15, `.dev.vars`/`.env.local`; MA: private repo as commit hash only |

### Machine config — handoff/lets-go

| Setting | Found |
| --- | --- |
| Transport | Proton Drive desktop client (Windows), `proton-drive` CLI mirror (Fedora); later local folder, Google Drive |
| Handoffs folder | `~/Proton Drive/<account>/My files/Documents/Handoffs` (desktop), `HANDOFFS_DIR=~/dev/handoffs` (Fedora mirror) |
| Cloud folder | `/my-files/Documents/Handoffs` |
| Shell | Git Bash on Windows; POSIX on Fedora |

Today three different rules choose the transport, and when `HANDOFFS_DIR` is unset on a CLI machine,
AR, GT and LB run `mkdir -p "$HANDOFFS_DIR"` anyway. An explicit machine setting removes both.

The map helper (`handoff-map.mjs`) ships inside the skill directory. Today it lives in the skill in
six repos and at `scripts/` in four, with four command sets (`get/set/clear`, `where/get/publish/clear`,
`get/publish/clear --expect`, `resolve/set null`). Only AR, CH, CA and HV have tests.

**As built** (2026-10-26; `skills/handoff/machine-config.md` is the reference):

- The machine config is `~/.config/handoffs/config` with `HANDOFFS_TRANSPORT` (`folder` when a sync
  client or nothing moves the folder, `proton-cli` for the CLI mirror), `HANDOFFS_DIR` and, for
  `proton-cli`, `HANDOFFS_REMOTE`. An environment variable of the same name overrides a line.
  `handoff-map.mjs config` proposes it from what it finds (a synced Proton folder, VA's discovery;
  else the CLI and an exported `HANDOFFS_DIR`), and `config --write` writes it once the user
  confirms.
- `handoff-map.mjs` reads the machine config (never repository settings; the key comes in as
  `--key`) and does the CLI transfers itself, judging each by the CLI's JSON summary. Commands:
  `get`, `name` (an unused `<key>-handoff-<date>[-topic].md`, checked against the cloud folder too),
  `set` (pushes the document, then pull → write → push → read back the cloud map, retrying up to
  three times), `clear --expect` (the same round with compare-and-swap) and `push` (a re-sent
  document, without the map). The map is written through a temporary file and a rename.
- Its tests live in `scripts/handoff-map.test.mjs`, with a fake `proton-drive` whose cloud folder is
  a directory, so the test file does not install into consumers.
- `lets-go` uses the copy in `.agents/skills/handoff/`, so it needs `handoff` installed beside it.

## Fixed in the skill body, not settings

These variations are accidental drift — one copy improved, the rest did not. The shared body takes
the best version, which keeps the catalog above short.

**ship**
- Merge base `origin/main`, not local `main` (CH, HV).
- Skip the release commit when nothing changed (CH); never force-push a rejected push (CH).
- Detect another open PR already claiming the next version (MA); handle a just-merged PR whose tag
  is not minted yet (HV).
- CH's backfill detection (normalized `comm` plus bot attribution) and its own-section detection
  (`git diff origin/main...HEAD -- CHANGELOG.md | grep '^+## \['`).
- Format before regenerating generated config (HV, MA).
- Fallback when `gh` is unavailable (CH).
- Fast checks run every `Fast checks` entry, and a red one refuses the push; a failure's fix
  command, when the entry names one, is offered in the report (AR #455). After a fix that writes,
  the list runs again from the top (HV, MA: mirrors are generated from formatted sources).
- Wait for the tag of a just-merged PR before computing the next version (HV); name another open PR
  whose changelog claims the same version (MA).
- Up to date with `origin/main` before shipping, offering a merge (NC).
- Follow the `docs-updater` skill inline where the harness has no subagent (NC).
- Human follow-ups before the PR (Decision 3), their links never in the public body (Decision 2).
- The issue link line, when `Issue link` is set (AR #456): take `N` from the branch per its
  pattern and read the issue (`gh issue view <N> --json title,labels,body`); open the body with
  the finishing line or the slice line. A branch with no number is exempt work: open with the
  waiver line when the user waived the flow, otherwise omit the line for the `Exempt` kinds. When
  the branch's number and the issue disagree, or finishing versus slice is unclear, ask before
  creating the PR. Refreshing an existing PR's body keeps its link line. With `Issue link: none`
  the body is written as before.

**end-session**
- Use the memory directory the harness supplies; never derive the slug (LB); with none named,
  skip the step. AR derived it, which CH, LB and PG warn against, until AR #455.
- Check the `gh` token's `project` scope before touching the board (VA); otherwise board writes fail
  silently.
- List the private follow-up repo explicitly with `-R` (HV).
- No `--limit 20` on merged-PR lookups (MA misses older branches).
- Finished branches by PR, not `git branch --merged` (AR #449), after `git fetch --prune origin`,
  with PR fields read into named variables (AR #452). One rule serves both merge styles, so it is
  not a setting. It is deliberately broader than AR's (decided 2026-10-26): AR calls a branch
  finished only when its PR is `MERGED` at exactly the branch tip; the shared body also accepts a
  tip that is an ancestor of the merged head (a stale local copy) and a branch with no PR whose tip
  is on `origin/main` (merged without a PR, or no commits of its own). Both add only branches whose
  every commit is already merged, and deleting still waits for a yes.

**handoff / lets-go**
- Re-pull the map immediately before writing; clear with compare-and-swap (`clear --expect`, LB);
  write atomically via temp file and rename (CA); re-download and verify after every push (AR
  #455: the cloud copy, into a temporary directory). An edited document is re-pushed without the
  map (`push`, AR #455). All of it lives in `handoff-map.mjs`, so the bodies carry no transfer
  commands.
- Push the document before the map that names it (VA); fail loudly on a silent push (MA).
- Folder discovery: VA's (any case, reparse-point aware, errors on ambiguity).
- Claim the handoff (clear) right after reading it, before reconciling the checkout (CH).
- File naming and collision check against the cloud folder (CA).
- end-session hand-off: CH's version plus VA's structured arguments, then correct the document.

**Lint**
- Ship apexracers#451's rule: reject bare `$0`–`$9` in any `SKILL.md`. VA's `handoff` passes
  arguments into `end-session`, so substitution is live in callers too.

## Decisions

Settled with the user on 2026-10-26. Settings format, settings definitions, step 0 without a user,
per-project install and the shared scripts are recorded under Architecture.

1. **Visibility: public.** Consumer repos are public and commit their skill copies, so the bodies
   are public already. Private companion names and board numbers stay out of this repository.
2. **Private links in a public PR body: forbidden.**
3. **Human follow-ups: filed before the PR**, fixed in the `ship` body.
4. **`handoff` replaces `mattpocock/skills`' `handoff`** under the same name; it began as a rewrite
   of that skill. Installing from here repoints the lock entry. Add `mattpocock/skills` skills by
   name (`-s`), never `--all`, so theirs cannot come back.
5. **`docs-updater` becomes a shared skill** reading `docs/agents/docs.md`. `ship` and
   `end-session` run it in a subagent where one exists, after completing its settings themselves
   (a subagent cannot ask); each repository deletes its `.claude/agents/docs-updater.md` when the
   skill is installed. Built 2026-10-27 with NC's `fix` and `check` modes and a scope (a diff range,
   a list of changes, or a full audit). It leaves its edits uncommitted and returns human actions
   to its caller, which runs the follow-up procedure once (CH: one agent publishes each).
6. **License: MIT**, at the root. `skills/handoff/LICENSE` keeps Matt Pocock's MIT notice (and
   `lets-go`'s too, if it also derives from his work), because a skill folder installs alone.
7. **Layout:** skills in `skills/<name>/`; catalog in `settings/` with
   `scripts/build-settings.mjs` copying it into each skill; canonical shared scripts with
   `node:test` suites in `scripts/`; `npm run check` locally and in CI.
8. **Deferred:** converging release schemes (a `releases.md` setting until `ship` is ported) and
   pruning overlapping third-party skills (a consumer-repo question, not this repository's).

## Convergence

Every install kept the repository's existing habits, so the settings files (330–630 lines each)
carried variety nobody had chosen. A survey on 2026-10-28 compared four settings across the ten
consumers, and the user chose to converge the repositories rather than the skills:

- **Defaults.** A definition may carry a **Default** line: a missing heading takes it without being
  asked for, and a repository writes the heading only to override it. `Release commit message`
  defaults by `Scheme` (`docs: update docs and changelog for v<version>` for `per-merge`, the
  dominant form; LB's two `cut-on-line` forms; PG's `docs: update docs for <summary>` for `none`);
  NC keeps an override, since its commits carry no type prefix. `Unreleased placeholder` defaults
  to `No unreleased changes.`, the form five repositories used; CA, VA and LB adopt it.
- **Follow-up wiki pages.** New pages are named `<Topic>-<YYYY-MM-DD>`, indexed from `human-todo`
  where a wiki has no index yet. Existing pages keep their names: issues link to them, and a wiki
  rename breaks every such link.
- **Fast checks.** The commands are each toolchain's own; what converges is the rule. Fast checks
  are the static gates plus each unit suite that finishes in about two minutes, run when its paths
  changed; slower suites stay in CI and are named. Six repositories ran no unit suite locally,
  against the old wording ("every required check that can run locally"), which none of them could
  meet without slowing every ship.
- **Not converged:** `Ask before bumping` splits evenly (always: CA, HV, LB, MA; when ambiguous: AR,
  CH, GT, VA) and stays per repository, by the user's choice on 2026-10-28: it records how closely
  the user wants to review each repository's releases, not a habit that drifted, so it carries no
  **Default** line: discovery proposes `when ambiguous` and each repository writes its choice.
  `Bump command` already follows from the version file.

## Unverified

- Whether `skills experimental_install` restores reliably from `skills-lock.json`.
- Whether the `skills` CLI supports any post-install hook (assumed not; step 0 does not need one).
- How `update`'s symlink behaves on Windows (symlinks may need Developer Mode).

## Verified

Pilot step 1, `skills` 1.7.4, 2026-10-26: a throwaway private GitHub repository with one skill,
installed into a scratch project on Fedora (`gh` authenticated).

- **A private GitHub source works** for both `add` and `update`. The lock records it as
  `sourceType: github` like a public one. This repository is public anyway (decided 2026-10-26).
- **`update` overwrites local edits without warning.** It compares the upstream folder hash with
  the lock's `computedHash` and never hashes the local copy. A local edit survives while upstream
  is unchanged, then the next upstream change replaces it with no prompt. Repository tailoring
  belongs in settings for exactly this reason.
- **The CLI writes `.claude/skills/` too.** `add --copy -y` copies the skill to every agent it
  detects, including `.claude/skills/<name>`. `update` re-runs `add` without `--copy`, which
  replaces that copy with a symlink to `.agents/skills/<name>`.
- **`sync-agents.mjs` corrupts the authored skill when that symlink is present.** The write pass
  writes the bannered mirror *through* the link, so the "GENERATED — do not edit" banner lands in
  `.agents/skills/<name>/SKILL.md`; the orphan pass then deletes the link, leaving the skill missing
  from `.claude/skills/` until a second run. Fixed here (links are removed before the write pass,
  with a regression test) in `scripts/sync-agents.mjs`; each repository takes the fixed copy at its
  pilot install. Until then, a repository that runs `skills update` must check
  `git diff .agents/skills` for the banner.
- **Claude Code does not read `.agents/skills/`.** Its skills docs and settings reference list only
  `.claude/skills/` for project skills, and Claude Code 2.1.310 listed a control skill there but not
  one placed only in `.agents/skills/`.
- **`add -a codex --copy -y` writes only `.agents/skills/<name>`**, with no `.claude/skills/` entry,
  even where a `.claude/` directory exists; re-running it replaces the skill.
- `update` cannot use a local `file://` source: the child `add` receives a folder-suffixed URL that
  is not a repository.
- `add ./ -s <name> -a codex --copy -y` from this checkout copies `skills/<name>` byte for byte
  (2026-10-26), locked as `sourceType: local`, source `.`.

`proton-drive` CLI 0.8.0, Fedora, 2026-10-26:

- `-j` goes after the subcommand (`filesystem download -j …`); before it, the CLI prints usage.
  Transfers then print one JSON line: `transferredItems`, `skippedItems`, `failedItems`,
  `failures`. An upload whose content the cloud already has counts as skipped.
- A missing remote file prints `Node not found: <name>` and exits 1 (older notes in the consumers
  say it exits 0). One missing path fails a whole multi-path download, so download one file at a
  time.
- `filesystem list -j <folder>` prints an array of nodes; the name is `name.value`.

## Found while surveying (fix in the source repos)

- ~~LB's `scripts/check-docs.mjs` parses `.claude/agents/docs-updater.md` for the canonical
  document list.~~ Fixed in LB#637. It ran that check only when the agent file existed, so removing
  the file would have switched the check off silently, not failed it. It now reads the `Doc map` in
  `docs/agents/docs.md` and fails when the map is missing.
- MA and VA keep area guides in `docs/agents/`, beside the settings files. Check their names
  against the settings topics (`docs`, `releases`, `ship`, `workspace`, `handoffs`,
  `issue-tracker`, `human-follow-up`) at their install. Neither clashed: MA's (`boards.md`,
  `labels.md` and the like) and VA's (`data-model.md`, `migrations.md` and the like) name app areas
  (MA#556, VA#477).

- ~~VA `ship` edits the PR body to link the private follow-up issue and wiki page, against Decision
  2.~~ Fixed in VA#477: its follow-up rules, `AGENTS.md` and `code-reviewer` keep the links in the
  closing report.
- ~~MA's `dev-flow.md` says a `Mints **vX.Y.Z**.` line follows the link line, but its `ship` never
  writes it.~~ Fixed in MA#556: its `dev-flow.md` now describes the `Release level:` line and the
  version the shared body writes beside it.
- `npx skills` run inside this repository resolves to this repository's own package (also named
  `skills`, no bin) and fails with "could not determine executable to run". Name the version:
  `npx skills@1.7.4`.

- ~~AR `ship` never runs `sync:agents:check`, though Agent Config Sync is a required check
  there.~~ Fixed in AR #455; the shared `Fast checks` setting must cover required checks.
- ~~VA's `skills-lock.json` records `handoff` as `mattpocock/skills`; the content is the user's.~~
  Fixed in VA#477, which recorded the shared `handoff`, as CH's and HV's installs did.
- No repository locks `handoff_map.json`. On the CLI mirror, handoff pulls before writing the
  document and pushes the whole map after `set`; lets-go has the same pull → clear → push window. A
  concurrent session lost an apexracers clear on 2026-10-26.
- ~~MA's map script hardcodes the Proton account and `My Files` casing.~~ Moot: MA#556 replaced it
  with the shared `handoff-map.mjs` and the machine config.
- `sync-agents.mjs` (shared verbatim by all 10) writes its banner into the authored skill when
  `skills update` has left `.claude/skills/<name>` as a symlink; see Verified.
- ~~GT `end-session` says nothing in `private/` can reach a commit; `private/` is its own
  repository.~~ Moot: GT#440 replaced it with the shared skill.
- ~~GT `end-session` fences POSIX commands as `powershell`; AR `end-session` says Git Bash on
  Linux.~~ Moot: GT#440 and AR#458 replaced both with the shared skill.

## Pilot plan

1. ~~Probe `npx skills add --copy` and `npx skills update -p -y` against a throwaway private
   repository.~~ Done 2026-10-26; see Verified.
2. Pilot `end-session`: write its generic body with step 0 and hooks; fill `workspace.md`,
   `issue-tracker.md`, `human-follow-up.md` and `docs.md` for AR (squash) and CA (merge commits, no
   companion); install into both, with `docs-updater`, which its docs step runs. **AR done
   2026-10-27** (apexracers#458, all five skills, the user's flow waiver, since AR's development
   flow counts `scripts/` as code). What it found:
   - `npx skills add jwh3times/skills ... -a codex --copy -y` replaced AR's four hand-copied skills
     in place and left its third-party skills alone; `npm run sync:agents` regenerated the mirror.
   - `ship` ran end to end on a `per-merge` repository: build level, next-version, changelog section
     and footer link, `Changelog check`, fast checks. `docs-updater` found drift the hand edits
     missed (two required checks absent from AGENTS.md) and gaps in AR's `Doc map`.
   - A one-line link fix in AR's privacy matrix source failed its required Driver Privacy Contract
     check, which pins that document's hash. Hence the `pinned` marker and its discovery hint.
   - Stale references to a renamed file sat in the companion and the private wiki, outside the
     `Doc map`. Hence docs-updater's wider rename search, and wiki fixes only after the merge.
   - AR's third-party `wizard` skill named `human-actions.md`; it was edited by hand, so the next
     `mattpocock/skills` install of it will undo that line.
   CA's install merged as causet#342. CH's (caitlyn-holland-vip#242) followed, the first beyond
   the pilot pair. What CH found:
   - CH forks its 13 `mattpocock/skills` skills in place (its ADR-0006), so a lock entry does not
     mean frozen. docs-updater skips only the skills the `Doc map` marks `frozen`, and discovery
     proposes a lock-listed skill as `frozen` unless the repository forks it. CH recorded the
     shared five in a new ADR-0011 beside ADR-0006.
   - The shared `handoff` replaces `mattpocock/skills`' `handoff` under the same name (Decision 4),
     so a forked router that names `/handoff` (CH's `ask-matt`) silently changes meaning. At each
     install, check the repository's routers and phase-boundary docs for `/handoff`.
   - CH's linter rejected a literal U+FEFF in `handoff-map.mjs` (fixed in #8), and its coverage
     counts `scripts/*.mjs`, so a consumer that globs `scripts/` excludes
     `lint-agent-neutrality.mjs` and its test from coverage, as it does `sync-agents`.
   - CH keeps its triage labels in `issue-tracker.md`, not `triage-labels.md`; end-session and the
     definitions now accept either. end-session regained the GitHub MCP fallback `ship` has.
   - CH's `sync:agents` runs Prettier over `.agents/**/*.md` first, so its `.prettierignore` lists
     the installed skills to keep them byte for byte.
   What CA found:
   - CA's lock lists `mattpocock/skills` skills beside the shared ones. Hence docs-updater skips
     every installed skill's body, and `Doc map` discovery proposes those folders as `frozen`.
   - CA's `Doc map` includes its public wiki's usage pages, so docs-updater's after-the-merge wiki
     search covers a `Doc map` wiki as well as the `Follow-up wiki`.
   - CA cuts releases by hand and a maintainer tags them, so `cut-on-line` no longer assumes a
     workflow tags each merge.
   - CA's follow-up policy carried points the shared `## Procedure` lacked (the responsible role,
     a decision's options, acceptance criteria and evidence, push before publication, no close on
     merge, no advisory publication); the Procedure now has them.
   What HV found (holland-vip#214):
   - HV's forked `ask-matt` also routed `/handoff` as `mattpocock/skills`' portable-file handoff,
     confirming the router check CH prompted.
   - HV names its private repository and board in its public files, so its settings write them
     literally; `discover:` is for repositories that keep them out.
   - HV's companion commit policy is `ask`: docs-updater's companion edit waited for the user's
     word. Its `gitleaks` pre-commit hook was absent on the Fedora machine, where the scan ran from
     the pinned `zricethezav/gitleaks` container instead.
   What GT found (GuardianTracker#440):
   - GT's ADR 0024 keeps work nobody has committed to as a board draft item, which `end-session`
     could not honor: it always opened an issue. Hence the `New work` setting (#10).
   - GT archives its 0.x–1.1 changelog lines in `docs/changelog/`, so the shared backfill, which
     reads `CHANGELOG.md` alone, saw 107 released versions as missing. `Skipped tags` **Ignore**
     covers archived lines.
   - GT's board `Status` has no blocked option: a `Blocked By` text field carries blockers, cleared
     after merges by `npm run board:blockers`. `Board fields` holds that as written.
   - GT's Format Check policy tests were one `node --test` list copied in CI and AGENTS.md; a root
     `test:policy` script now holds it, and the `Fast checks` call that.
   - GT's vendored `wizard` linked the renamed follow-up file; its link was fixed by hand, which a
     `mattpocock/skills` update will undo, as at AR.
   - `lint-agent-neutrality.mjs` lints the repository it lives in, not the working directory, so
     running this repository's copy against a consumer checked the wrong tree. It now takes an
     optional root and names the root it linted.
   What PG found (PressGolf#182):
   - PG was the first install with `Scheme: none` and no companion, board or wiki: `ship` skipped
     its versioning section, and no wiki search was owed after the merge.
   - Its `SECURITY.md` sends reporters to private vulnerability reporting, which was off. The
     install filed that as a human follow-up (PG#183), and the user turned it on.
   - PG's impact flags moved under `Hook: before PR`, and `AGENTS.md` records the switch; PG keeps
     no ADRs for tooling.
   What NC found (Nearcited#237):
   - NC's `ship` checked the diff against a rules table before the docs refresh and fast checks.
     The table moved verbatim to `docs/agents/ship.md` `## Rule triggers`, run by `Hook: before PR`,
     which runs after them, so a fix found there means running both again. The user accepted that;
     a `Hook: before docs` is the remedy if the re-runs get in the way.
   - NC's `AGENTS.md` and README recommended `npx skills update -p -y`, which Verified rules out.
     docs-updater replaced it with the install command; check each repository's docs for it.
   - Biome failed the lint's test file on line width and quotes, so `biome.json` excludes
     `scripts/lint-agent-neutrality*.mjs` beside its `sync-agents` line. Each consumer's formatter
     needs the lint scripts and the installed skills ignored (CH's and LB's Prettier, LB's cspell).
   - NC's owner-only `THIRD_PARTY_NOTICES.md` said every skill came from `mattpocock/skills`. With
     approval it gained one sentence naming the shared five, and its `Doc map` entry now fires
     when a skill is replaced. NC's vendored `ask-matt` routed `/handoff` too; `dev-flow.md` routes
     around it rather than editing the vendored skill.
   What LB found (LeaseBook#637):
   - LB's `check-docs.mjs` silently skipped its `Doc map` coverage without the agent file (see
     Found while surveying). It now fails closed.
   - LB treats every file under `docs/` as a living document: four metadata lines and a
     `Last reviewed` date that CI fails a day after the commit. The skills edit their settings
     files (step 0, docs-updater) without bumping that date, so `check-docs.mjs` exempts the seven
     settings topics from the metadata and freshness rules, while still scanning them for authority
     claims. A consumer with a document-lifecycle rule needs the same exemption.
   - LB commits the public change first and records its PR or SHA on the private follow-up before
     committing the companion; the shared `ship` would commit companion edits before the PR exists.
     LB's `Companion commit policy` is `ask`.
   - LB's human-action rules moved to `human-follow-up.md`; the `## Required human-action handoff`
     heading in `issue-tracker.md` stays as a pointer, so the anchors `AGENTS.md` and `wizard` link
     to still resolve.
   - LB's `check-docs.mjs` rejects some commands in `docs/agents/` (`npm run typecheck`), so its
     `Fast checks` call `npm run build`, which runs `tsc -b`.
   What MA found (magic-agenda#556):
   - MA's `human-follow-up.md` spoke of a "designated private project board", so the survey assumed a
     second board. There is one: MA's project is private and holds both repositories' issues, and
     only public ones are auto-added. `Board` serves both, and `Follow-up board` is `same as Board`.
     Check `gh project item-list` for which repositories a board holds before proposing a second.
   - Vitest's default include matched `lint-agent-neutrality.test.mjs`, a `node:test` file, and
     failed `npm test` with "No test suite found". MA excludes it beside `sync-agents.test.mjs`; a
     consumer whose test runner globs the whole repository needs the same exclusion.
   - MA's Prettier formats every Markdown file, settings files included, and split a code span
     across two lines in two of them (as at GT). After formatting, look for a line with an odd count
     of backticks outside a fence.
   - MA's `human-follow-up.md` was a full procedure. It became the four settings and a "Done when"
     line; the shared `## Procedure` covered every step it had.
   - MA's old `ship` left the full suites and the build to CI. Its `Fast checks` keep that choice
     and name the CI-only required checks, short of the setting's "every required check that can
     run locally".
   - MA's private wiki had a Fedora handoff runbook built on an exported `HANDOFFS_DIR` and the old
     `scripts/handoff-map.mjs`, as HV's did. Each repository with such a page needs it rewritten for
     the machine config after its install.
   What VA found (valleys-at-ashebrook-hoa#477):
   - VA's Prettier formats `.agents/skills/` (it ignores only the generated trees), so it failed 31
     installed files. Its `.prettierignore` lists the five shared skills and the lint pair; running
     `npm run format` on them instead would fork them from upstream. Check each consumer's
     formatter for `.agents/skills/` coverage at its install.
   - VA's type-aware oxlint rejected the lint script's bare `.sort()`
     (`typescript/require-array-sort-compare`). #14 gave it an explicit code-unit comparator, so VA
     carries no override; the other nine take it at their next refresh. Its test file joined VA's
     existing `no-floating-promises` override for `sync-agents.test.mjs`.
   - VA's old `ship` linked the private follow-up issue and wiki page from the PR body, and
     `code-reviewer` required those links. Both now keep them in the closing report (Decision 2),
     and the rules moved to `human-follow-up.md`, with VA's contact-value scan before a wiki push in
     `Follow-up wiki`. The `issue-tracker.md` heading stays as a pointer for older links.
   - Six early releases (`v0.1.1`–`v0.1.6`) have no changelog section, beside the 4-part `v0.1.0.x`
     tags. Both are **Ignore** entries, so backfill does not invent them, as GT's archived lines
     needed. Compare tags against `CHANGELOG.md` before proposing `Skipped tags`.
   - VA records agent tooling in ADRs, so the switch got ADR 0029, with an update note on ADR 0021,
     whose "format before sync" no longer covers the installed skills.
3. ~~If updates flow, do `ship` and `releases.md`/`ship.md`.~~ Written early, 2026-10-27, by the
   user's choice, so the pilot can install all four skills. (`handoff`/`lets-go` and the machine
   config were written early, 2026-10-26, so this repository could hand off between machines.)
