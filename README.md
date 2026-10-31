# skills

Agent skills shared across jwh3times repositories, for Claude Code and Codex. Each skill's body is
identical in every repository; what is specific to a repository lives in that repository's
`docs/agents/` settings files, which each skill proposes and writes on its first run.

| Skill | Does |
| --- | --- |
| `end-session` | Closes out a session: memory, issues and the board, human follow-ups, docs, workspace. |
| `handoff` | Hands the session to another machine through the Handoffs folder, then runs `end-session`. |
| `lets-go` | Resumes the active handoff on the other machine. Needs `handoff` installed beside it. |
| `ship` | Takes a finished branch to an open PR: release level, docs, changelog, human follow-ups, fast checks. |
| `docs-updater` | Finds where the docs and the code disagree and fixes the docs, or reports it in `check` mode. `ship` and `end-session` run it, so install it beside them. |

## Install, and later update

```bash
npx skills add jwh3times/skills -s end-session -s handoff -s lets-go -s ship -s docs-updater -a codex --copy -y
node scripts/sync-agents.mjs   # mirror .agents/skills/ into .claude/skills/ for Claude Code
```

Re-running the same command is the update. Never run `npx skills update`; see
[docs/design.md](docs/design.md) for why, and for the architecture.

The CLI installs only skills. The settings' defaults also call scripts, which a repository copies by
hand from `scripts/` here, each with its test:

| Script | Copied by | Does |
| --- | --- | --- |
| `sync-agents.mjs`, `lint-agent-neutrality.mjs` | every repository | Mirror the skills for Claude Code, and lint them for tool neutrality. |
| `check-docs.mjs` | every repository | Checks local links, and that the `Doc map` matches the documents. |
| `sync-main.mjs` | a repository with a private companion | Fast-forwards the checkout and the companion to `origin/main`, both or neither. |
| `next-version.mjs`, `check-changelog.mjs` | a repository with a changelog | Print the version the next merge mints, and verify the changelog for that merge. |
