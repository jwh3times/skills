# Dependabot

Dependabot updates only this repository's GitHub Actions (`.github/dependabot.yml`); there is no
lockfile to reproduce, so a review reads the workflows each bumped action is used in.

## Grounding facts

- The only dependencies are the actions in `.github/workflows/check.yml` and
  `.github/workflows/consumers.yml`. `package.json` declares no packages, and the scripts import
  only Node's standard library.
- Every `uses:` is pinned to a full commit SHA with a `# vX.Y.Z` comment, and the repository's
  Actions settings require SHA pins: a bump that leaves a tag reference fails every run.
- CI runs `npm run check` on Linux with Node 22 and 26, and on Windows with Node 26 (`check.yml`).
  An action major that changes `actions/setup-node`'s inputs or `actions/checkout`'s defaults
  (credentials, fetch depth) reaches every job.
- `consumers.yml`'s sync job runs `actions/create-github-app-token` with the release App's key, in
  the `consumer-sync` environment, and pushes to each synced consumer with the token. A bump of
  that action, or of `actions/checkout` there, is always reviewed against both of its steps.
- Nothing deploys from here; the effect of a broken `consumers.yml` is a red run on `main` and
  consumers left behind until it is fixed.

## Review triggers

- `actions/create-github-app-token`, any bump: its token pushes to every synced consumer.
