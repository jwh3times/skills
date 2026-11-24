# Traps across the consumers

Facts learned while rolling the shared skills and scripts out to the consumer repositories. They
hold for more than one consumer, so none of them belongs in a single repository's
`docs/agents/`. A trap that turns out to belong to one repository moves there.

## Setting up a consumer

Found bootstrapping hopover (2026-11-24); each is GitHub's behavior, so it holds for every new
consumer.

- **CodeQL default setup accepts only languages on the default branch.** Enabling a language
  that is still only on the bootstrap branch, such as `actions` before the first workflow merges
  or `javascript-typescript` before `scripts/*.mjs` does, fails with HTTP 422, "One or more
  languages you selected are not present in the repository". Enable what `main` has, then add the
  rest after the bootstrap merges. GitHub's language statistics can lag that merge by an hour or
  more, and the 422 lasts until `gh api repos/<owner>/<repo>/languages` lists the language.
- **A PR opened before CodeQL is set up is `BLOCKED` until its next push.** The `main` ruleset's
  code scanning rule needs a CodeQL analysis of the PR's head, and default setup analyzes a pull
  request only on a push. With every check green and no alerts, an empty commit on the branch
  starts the analysis.
- **The release App must be installed before the ruleset can name it.** Creating the `main`
  ruleset with the App as its bypass actor fails with HTTP 422, "Actor release-stamper
  integration must be part of the ruleset source or owner organization", until the App is
  installed on the repository. Create the ruleset without the bypass actor, or wait for the
  install, then add the actor with a `PUT` of the whole ruleset.
- **Dependabot's `uv` updater supports only a range of Python versions,** 3.10 to 3.15 on
  2026-11-24, and reads it from `.python-version`. A pin outside the range fails every `uv`
  update job before it reads a dependency, with `tool_version_not_supported`, and no PR or issue
  says so: read the `Dependabot Updates` runs (`gh run list`, event `dynamic`) after a consumer's
  first scheduled update.

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
