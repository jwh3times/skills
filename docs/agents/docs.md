# Docs

## Docs refresh

- `docs/design.md` — the architecture, settings catalog, Decisions, Verified and Unverified, and
  Pilot plan.
- `AGENTS.md` — durable rules for working in this repository.
- `README.md` — what is published, and the install command.

## Session doc routing

- `docs/design.md` — when a decision is settled, a `skills` CLI question is tested (Verified and
  Unverified), the pilot advances (Status line and Pilot plan), or a consumer-repository problem
  turns up (Found while surveying).
- `AGENTS.md` — when a durable rule for working in this repository changes.
- `README.md` — when what is published, or how to install it, changes.

## Docs validation

`npm run check`
