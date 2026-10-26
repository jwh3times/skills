# skills

Agent skills shared across jwh3times repositories, for Claude Code and Codex. Each skill's body is
identical in every repository; what is specific to a repository lives in that repository's
`docs/agents/` settings files, which each skill proposes and writes on its first run.

| Skill | Does |
| --- | --- |
| `end-session` | Closes out a session: memory, issues and the board, human follow-ups, docs, workspace. |
| `handoff` | Hands the session to another machine through the Handoffs folder, then runs `end-session`. |
| `lets-go` | Resumes the active handoff on the other machine. Needs `handoff` installed beside it. |

## Install, and later update

```bash
npx skills add jwh3times/skills -s end-session -s handoff -s lets-go -a codex --copy -y
node scripts/sync-agents.mjs   # mirror .agents/skills/ into .claude/skills/ for Claude Code
```

Re-running the same command is the update. Never run `npx skills update`; see
[docs/design.md](docs/design.md) for why, and for the architecture.
