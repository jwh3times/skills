# Topic: docs

`docs/agents/docs.md` — which documents a session keeps current, and how they are checked.

## Session doc routing

- **Read by:** end-session
- **Value:** bulleted list of documents (public or in the companion) a session's discoveries may
  land in, each with **when** to update it — and, where it applies, one marker:
  - `frozen` — read it, never update it (an archive, design history);
  - `append-only` — add entries, never change or delete one (captured API responses);
  - `amend-only` — dated records corrected by an amendment note, never rewritten.
- **Discover:** the repository's and companion's docs indexes (`docs/README.md`,
  `private/README.md`), `AGENTS.md`, and existing `end-session` routing tables.

## Docs validation

- **Read by:** end-session
- **Value:** `none`, or commands that check the docs (a docs test, a companion docs gate).
- **Discover:** `test:docs`-style scripts in `package.json`, docs checks in CI workflows, and
  scripts under `private/scripts/`.
