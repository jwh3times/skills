# Traps across the consumers

Facts learned while rolling the shared skills and scripts out to the consumer repositories. They
hold for more than one consumer, so none of them belongs in a single repository's
`docs/agents/`. A trap that turns out to belong to one repository moves there.

## Releases and deploys

- **Deployers and the stamp commit.** `version.yml`'s `[skip ci]` stamp commit lands on `main`
  right after each merge.
  - GitHub Actions honors `[skip ci]`, and so do Cloudflare Pages and Workers Builds (the latter
    with no watch path configured).
  - Railway ignores `[skip ci]`. It deploys the stamp commit, which supersedes the merge's
    deploy.
  - Check every Git-integrated deployer for that supersede effect, not only for whether it deploys
    the same code.
- **`workflow_run` deploys.** A `workflow_run` deploy must check out
  `github.event.workflow_run.head_sha`. After a merge, `main`'s tip is the stamp commit, and the
  run's listed head is the default branch's head, not the merge.
- **Bash steps in GitHub Actions** run with `-eo pipefail`, so `git show … | awk '{exit}'` fails on
  SIGPIPE. Write to a file first.

## Working in a checkout

- **Rehearsals.** A local `git clone` of a checkout copies its stale local `main` and its current
  branch. Base a rehearsal on the source's `origin/main`.
- **Prettier and the canonical scripts.** Never pass the canonical `.mjs` scripts to
  `prettier --write`, which rewrites them. Check stamped output with the repository's pinned
  Prettier, not a bare `npx` in a clone with no `node_modules`.
- **`gh pr merge --delete-branch`** removes a local worktree checked out on the merged branch.
  Unlink any junction inside that worktree first. On Windows, a junction to another checkout's
  `node_modules` would otherwise leave that folder exposed to whatever deletes the rest.
- **Whitespace.** causet checks whitespace on every file it carries from here, so skills CI runs
  `git diff --check` over the whole tree.

## Agents and routines

- **Merges.** Subagents can't merge: the `land` skill stops them ("No user, no merge"), and the
  permission classifier blocks a subagent's merge too. Subagents ship and bring a PR to `ready`;
  the main session runs the merge.
- **Cloud routines.** The claude.ai routine environment answers GraphQL with 403, so helpers a
  routine runs must use REST only (`dependabot.mjs` does). The job-log host is blocked there too:
  see [the Dependabot review routine's prompt](routines/dependabot-review.md).
