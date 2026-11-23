# Test proof

## Test commands

- repo root: `scripts/*.test.mjs`, node's built-in test runner (`node:test`).
  - One file: `node --test <file>`; one test by name:
    `node --test --test-name-pattern='<name>' <file>`, with `<name>` regex-escaped.
  - The test count is node's `ℹ tests N` summary line, which `mutate.mjs` reads already.
  - The scratch worktree needs nothing: `package.json` has no dependencies, so there is no
    `node_modules` to link and no setup command.

## Zero-match signature

none

## Guide

none
