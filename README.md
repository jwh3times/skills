# skills

Agent skills shared across jwh3times repositories, for Claude Code and Codex. Each skill's body is
identical in every repository; what is specific to a repository lives in that repository's
`docs/agents/` settings files, which each skill proposes and writes on its first run.

| Skill | Does |
| --- | --- |
| `end-session` | Closes out a session: memory, issues and the board, human follow-ups, docs, workspace. |
| `handoff` | Hands the session to another machine through the Handoffs folder, then runs `end-session`. |
| `lets-go` | Resumes the active handoff on the other machine. Needs `handoff` installed beside it. |
| `open-pr` | Takes a finished branch to an open PR: release level, docs, changelog, human follow-ups, fast checks. |
| `land` | Merges a PR the user names: catches it up, waits for its checks on the current head, explains a blocked merge, then confirms the release tag, the deploys, and the closed issues' board status. Needs `end-session` and `ci-triage` installed beside it. |
| `dependabot` | Reviews the open Dependabot PRs: reads CI first, reproduces the lockfile install, reads the release notes of every major, and posts an evidence-based verdict; then, on the user's word, pushes a known fix and hands the PRs the user names to `land`. Never merges on its own. Needs `land` and `ci-triage` installed beside it. |
| `docs-updater` | Finds where the docs and the code disagree and fixes the docs, or reports it in `check` mode. `open-pr` and `end-session` run it, so install it beside them. |
| `what-next` | Ranks the open work across the trackers and the board, puts an active handoff and overdue deadlines first, and recommends what to pick up next. Read-only. Needs `handoff` installed beside it. |
| `test-prover` | Proves a change's new tests in a scratch worktree: each runs on its own and matches a test, goes red with the fix reverted, and catches each changed guard being broken. Runs in a subagent of its own; `open-pr` runs it when a branch adds tests. |
| `ci-triage` | Reads a red check, read-only: the failing step, the log's first error, the repository's known reds and `main`'s runs, and classes it known red, runner/infra, likely flake, real failure or unknown. Runs in a subagent of its own; `land` and `dependabot` run it. Reads `land`'s `land.mjs` for the required checks when `land` is installed beside it. |
| `records-audit` | Audits the board, the trackers, the follow-up wiki and the changelog against each other, read-only, and names the fix for each finding; run it weekly. Needs `end-session` installed beside it. |

## Install, and later update

```bash
npx skills add jwh3times/skills -s end-session -s handoff -s lets-go -s open-pr -s land -s dependabot -s docs-updater -s what-next -s test-prover -s ci-triage -s records-audit -a codex --copy -y
node scripts/sync-agents.mjs   # mirror .agents/skills/ into .claude/skills/, write the AGENTS.md blocks
```

Re-running the same command is the update. Never run `npx skills update`; see
[docs/design.md](docs/design.md) for why, and for the architecture.

`open-pr` brings text every repository's `AGENTS.md` shares, and `sync-agents.mjs` fails until
`AGENTS.md` carries the marker lines of each block, or the `AGENTS.md blocks` setting leaves that
block out: see [settings/agents-md.md](settings/agents-md.md). Its `shared-skills` block also holds a
second install command, for the `mattpocock/skills` snapshot every repository runs, pinned by commit;
`check-skills.mjs` fails until both have run.

The CLI installs only skills. The settings' defaults also call scripts, which a repository copies
from `scripts/` here, each with its test:

| Script | Copied by | Does |
| --- | --- | --- |
| `sync-agents.mjs`, `lint-agent-neutrality.mjs` | every repository | Mirror the skills for Claude Code and write the shared `AGENTS.md` blocks, and lint the skills for tool neutrality. |
| `check-docs.mjs` | every repository | Checks local links, and that the `Doc map` matches the documents. |
| `check-skills.mjs` | every repository | Fails when an installed skill differs from `skills-lock.json`, or the lock from the shared install commands. |
| `guard.mjs` | every repository | A Claude Code hook, registered in `.claude/settings.json` by `sync-agents.mjs`: denies or asks before risky git commands and edits to generated files, warns about Windows shell hazards, and applies the repository's own rules from `docs/agents/guard.md`. |
| `sync-main.mjs` | a repository with a private companion | Fast-forwards the checkout and the companion to `origin/main`, both or neither. |
| `next-version.mjs`, `check-changelog.mjs` | a repository with a changelog | Print the version the next merge mints, and verify the changelog for that merge. |
| `stamp-changelog.mjs` | a repository with `Scheme: stamp-on-tag`, beside the two above | Run by the tag workflow: turns each merge's `changelog.d/` fragments, or its PR title, into its dated section and tags the merge commit. |

To update another repository's checkout in one step, run `node scripts/consumer-sync.mjs <checkout>`
from a clone of this repository: it re-runs the install commands there, copies each script above
that every repository carries and each other one the checkout already has, and runs its
`sync-agents.mjs`. It commits nothing.
