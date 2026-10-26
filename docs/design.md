# Shared skills: design

Status: proposal, 2026-10-26. Nothing here is built yet.

## Goal

Publish the skills the user wrote — `ship`, `end-session`, `handoff`, `lets-go`, and possibly
`docs-updater` — from this one repository, installable into any repository. Installing adapts a skill
to its repository, but **by writing settings, not by editing the skill**: the skill body stays
identical everywhere so fixes flow to every repository through `npx skills update`.

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

**Hooks cover genuinely repo-only steps.** A skill names fixed points ("before fast checks", "after
sync", "extra cleanup"); a repo settings file may list steps under a hook, which the skill runs at
that point. A repository whose workflow differs in kind, not in values, keeps its own skill under its
own name (e.g. `pressgolf-release`) rather than bending the shared one.

**Install and update.**

```bash
npx skills add jwh3times/skills --copy      # install into .agents/skills/
node scripts/sync-agents.mjs                # regenerate .claude/skills/
npx skills update -p -y                     # later: pull new skill versions
node scripts/sync-agents.mjs                # twice, until the symlink bug is fixed (see Verified)
node scripts/sync-agents.mjs --check
```

`handoff`/`lets-go` are candidates for a machine-wide install (`-g`), since most of what varies about
them depends on the machine, not the repository.

## Settings catalog

Values come from reading every copy on 2026-10-26. Abbreviations: AR apexracers, CA causet, CH
caitlyn-holland-vip, GT guardiantracker, HV holland-vip, LB leasebook, MA magic-agenda, NC Nearcited,
PG PressGolf, VA valleys-at-ashebrook-hoa. Kind: **value** (command, path, name), **toggle** (a shared
step on or off), **step** (selects one of several implementations), **hook** (repo-only steps).

### `docs/agents/workspace.md` — new; read by all four skills

| Setting | Found | Kind |
| --- | --- | --- |
| Merge style | squash: AR, LB. Merge commits: the other 8 (measured from the last 5 merged PRs). Selects finished-branch detection: PR `headRefOid` equals branch tip (squash), `git branch --merged` (merge), with LB's tree comparison when `main` has moved on | step |
| Private companion | none (CA, PG) or `private/`; repo named in the file (AR, HV, VA) or discovered from the checkout (LB, NC, GT, MA, CH — deliberately keeps the locator out of the public tree) | value |
| Companion status command | `node scripts/repository-status.mjs --check-private` (AR), `git -C private status` (others) | value |
| Companion commit/push policy | report and ask (AR), leave to `/ship` (CH), never without authorization (HV), expected (LB, NC, VA), gated: diff review + value scan + visibility check + approval (MA) | step |
| Companion bootstrap | `npm run bootstrap:private` (MA, NC, VA) | value |
| Sync with `main` | `npm run sync:main` (AR, CH, HV, VA), plain fast-forward (LB, PG), `cst pull --ff-only` (CA) | value |
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
| Board fields and values | AR Status (Todo/In Progress/Blocked/Parked/Done) + Blocked by; HV `Deferred` for Parked; CH, CA Status/Gate/Area; GT Status/Blocked By/Chain/Order/Gate/ADR/Triage; LB Track/Gate; MA Phase/Priority/Size/Status (auto-adds public issues); NC Status/Stage/Gate; VA Status/Gate/Area/Next Action/Blocking Item |
| Security findings | draft repository advisory (AR — plus a draft board item — CH, CA, HV); private issue labelled `security` (LB); private doc (GT `security-limitations.md`, MA README register, VA tracker + wiki); `SECURITY.md` (PG) |

Labels stay in `triage-labels.md`. Extras beyond the five canonical labels: CA
`human-action-required`; LB `blocked-by-human`, `security`, `product-decision`; NC
`bug`/`enhancement`/`documentation`. CH has no `triage-labels.md`.

### `docs/agents/human-follow-up.md` — exists under four names; normalize

Today: `human-actions.md` (AR), `human-followups.md` (GT), `human-follow-up.md` (MA),
`docs/human-followups.md` (CA), an anchor in `issue-tracker.md` (CH, LB). Read by ship, end-session,
docs-updater.

| Setting | Found |
| --- | --- |
| Issue destination | private companion repo (most), public repo (CA), checkbox in a public tracking issue (NC #17), labelled issue only (PG) |
| Label | `ready-for-human`, `human-action-required`, `blocked-by-human` |
| Wiki | private `human-todo` (AR, CH, GT, LB, MA); `Runbook-<slug>` pages (HV); public wiki (CA); `Human-TODO` with a contact-value scan (VA); none (NC, PG) |
| Wiki push pre-authorized | CH |

### `docs/agents/releases.md` — new everywhere except MA (VA's `ci-and-release.md` overlaps)

| Setting | Found |
| --- | --- |
| Scheme | **rollup-per-merge** (AR); **dated per merge plus backfill of skipped tags** (CH, GT, HV, MA, VA); **accumulate, cut only on a major/minor change** (LB); **none** (NC, PG — ship skips its versioning section) |
| Version file | `web/package.json` (AR), `package.json` (CH, HV, MA, VA), `VERSION` (GT, LB) |
| Bump command | `npm version <x.y.0> --no-git-tag-version` (AR), `npm version <floor>` (CH), `npm version minor\|major` (HV, MA), `npm version <exact> --allow-same-version` (VA), edit `VERSION` (GT, LB) |
| Ask before bumping | always (HV, LB, MA), only when ambiguous (AR, CH, GT, VA) |
| Next-version command | `bash scripts/next-version.sh` (AR, CH, GT, VA), `node scripts/next-version.mjs` (HV, MA), computed in `version.yml` (LB) |
| Legacy tags to ignore | `v1.0.0.x` (CH, HV), `v1.1.1.x` (MA) |
| Unreleased placeholder | `No unreleased changes.` (AR, CH, GT, HV, MA), empty (VA), `- _Nothing yet._` (LB) |
| Extra headings | `Deprecated` (LB); `Internal`, `Docs` (MA) |
| Footer links | compare (AR, GT, MA, VA), release tag on cut (LB), none (CH, HV) |
| Local changelog check | `bash scripts/verify-changelog-version.sh` (AR), `node scripts/check-changelog.mjs` (MA); CH, GT, HV, VA have a script and CI job but ship does not run it |
| Release commit message | `chore(release): prepare v<v>` (AR), `chore: prepare release v<v>` (CH), `docs: update docs and changelog for v<v>` (GT, HV), `docs: changelog and docs for v<v>` (MA), `docs: prepare release v<v>` (VA), `docs: update docs and changelog` (LB), `docs: update docs for <topic>` (PG), plain sentence (NC) |

### `docs/agents/docs.md` — new

| Setting | Found |
| --- | --- |
| Refresh method | `docs-updater` agent (AR, CH, GT, HV, LB, MA, VA; NC reads the agent file when no agent harness exists); `docs-updater` skill (CA); inline doc list (PG) |
| Docs owned | per-repo list given to the refresher |
| Changelog owner during ship | ship (AR, HV, LB declare it); GT, MA, VA's agent claims it, so ship must say to leave it alone |
| Private-doc routing (end-session) | file → when to update; frozen files (AR `archive.md`, LB design history, VA session history); append-only folders (AR captured API responses); amend-only dated docs (MA) |
| Docs validation | `npm run test:docs` (CA), `private/scripts/check-docs.mjs` (LB) |

### `docs/agents/ship.md` — ship-only

| Setting | Found |
| --- | --- |
| Fast checks | list of {folder, command, optional "only when these paths changed"}. AR: `web/` prettier, lint, build; root `dotnet build`. GT adds Go `gofmt`/`go vet`. LB `dotnet format --verify-no-changes`, conditional `api:generate`. NC conditional wrangler dry-run and e2e. PG runs `test:coverage` and a 90% patch-coverage script |
| Branch naming | `agent/<topic>` (CH, GT, HV), `<type>/<topic>` (LB, PG), `feat/…`, never `release/*` (MA) |
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
- Fallbacks when `docs-updater` or `gh` is unavailable (NC, CH).

**end-session**
- Use the memory directory the harness supplies; never derive the slug (LB). AR derives it, which
  CH, LB and PG warn against.
- Check the `gh` token's `project` scope before touching the board (VA); otherwise board writes fail
  silently.
- List the private follow-up repo explicitly with `-R` (HV).
- No `--limit 20` on merged-PR lookups (MA misses older branches).

**handoff / lets-go**
- Re-pull the map immediately before writing; clear with compare-and-swap (`clear --expect`, LB);
  write atomically via temp file and rename (CA); re-download and verify after every push.
- Push the document before the map that names it (VA); fail loudly on a silent push (MA).
- Folder discovery: VA's (any case, reparse-point aware, errors on ambiguity).
- Claim the handoff (clear) right after reading it, before reconciling the checkout (CH).
- File naming and collision check against the cloud folder (CA).
- end-session hand-off: CH's version plus VA's structured arguments, then correct the document.

**Lint**
- Ship apexracers#451's rule: reject bare `$0`–`$9` in any `SKILL.md`. VA's `handoff` passes
  arguments into `end-session`, so substitution is live in callers too.

## Open decisions

1. **Private links in a public PR body.** VA adds them; CH, GT and LB forbid them. Proposal: forbid.
2. **When ship files human follow-ups.** Before the PR in most copies; after it in MA and VA.
   Proposal: before, fixed in the body.
3. **Release schemes.** Keep all four, or converge? Rollup-per-merge and dated-plus-backfill differ
   mostly in how Dependabot tags are treated.
4. **`docs-updater`.** Make it a sixth shared piece? ship and end-session depend on it in 8 repos,
   and today its body is repo-specific.
5. **Machine-wide install** for `handoff`/`lets-go`.
6. **Prune overlapping third-party skills** (`grill-me`/`grill-with-docs`/`grilling`; possibly
   `teach`, `wayfinder`, `to-questionnaire`, `wait-what`). No usage data gathered.

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
- **`sync-agents.mjs` needs two runs to repair that symlink.** The write pass checks
  `.claude/skills/<name>/SKILL.md` through the link, finds it current, and skips it; the orphan pass
  then deletes the link. After one run the skill is missing from `.claude/skills/` (`--check`
  fails); a second run restores it. Until the script is fixed (remove strays before writing), the
  update sequence is `skills update -p -y`, then sync twice, then `sync --check`.
- `update` cannot use a local `file://` source: the child `add` receives a folder-suffixed URL that
  is not a repository.

## Found while surveying (fix in the source repos)

- AR `ship` never runs `sync:agents:check`, though Agent Config Sync is a required check there.
- CH, HV and VA's `skills-lock.json` record `handoff` as `mattpocock/skills`; the content is the
  user's. `skills update` could overwrite it. (CH and VA store the same hash for different files.)
- No repository locks `handoff_map.json`. On the CLI mirror, handoff pulls before writing the
  document and pushes the whole map after `set`; lets-go has the same pull → clear → push window. A
  concurrent session lost an apexracers clear on 2026-10-26.
- MA's map script hardcodes the Proton account and `My Files` casing.
- `sync-agents.mjs` (shared verbatim by all 10) leaves a skill missing from `.claude/skills/` after
  one run when that directory is a symlink; see Verified.
- GT `end-session` says nothing in `private/` can reach a commit; `private/` is its own repository.
- GT `end-session` fences POSIX commands as `powershell`; AR `end-session` says Git Bash on Linux.

## Pilot plan

1. ~~Probe `npx skills add --copy` and `npx skills update -p -y` against a throwaway private
   repository.~~ Done 2026-10-26; see Verified.
2. Pilot `end-session`: write its generic body with step 0 and hooks; fill `workspace.md`,
   `issue-tracker.md`, `human-follow-up.md` and `docs.md` for AR (squash) and CA (merge commits, no
   companion); install into both.
3. If updates flow, do `ship` and `releases.md`/`ship.md`, then `handoff`/`lets-go` with the machine
   config.
