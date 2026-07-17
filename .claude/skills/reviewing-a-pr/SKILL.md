---
name: reviewing-a-pr
description: Use when reviewing a Nextly pull request, responding to review-bot feedback (CodeRabbit, Greptile), or preparing a PR to pass review.
---

# Reviewing a PR in the Nextly monorepo

## The review bar

- **Verify before you trust.** For every review-bot suggestion (CodeRabbit,
  Greptile), check the claim against the actual code and, where cheap, run
  the relevant test. Bots are frequently right about style and frequently
  wrong about behavior; apply fixes for confirmed issues, and push back with
  evidence (file/line, test output) when a suggestion is wrong. Never apply
  a suggestion you cannot explain.
- **Reply and resolve every thread.** Each bot comment gets a reply stating
  what was done (fixed in <commit>, or why it is not a real issue), then the
  thread is marked resolved so the bot can re-verify.
- **Check the PR against the repo's invariants** (ARCHITECTURE.md "Key
  invariants" and AGENTS.md conventions): envelope shapes, NextlyError
  usage, Drizzle-only, token-driven admin styling in both modes, changeset
  presence/absence, comment style (explains code, never references tasks or
  conversations), no AI attribution anywhere.

## Mechanical checks

- PR title: Conventional Commits; scopes are package-based plus
  `playground|root|ci|docs|deps|release`; subject starts lowercase. Fix the
  title rather than bypassing the check.
- Tests: the PR adds/extends tests for what it changes; no new failures
  against the known baseline; integration-heavy changes name which dialect
  legs cover them.
- Changeset: exactly one for published-code changes (all packages, patch);
  none for test/CI/docs-only PRs.

## Recurring defect classes (look for these specifically)

- Malformed Tailwind: stray spaces before `:` modifiers, duplicated opacity
  suffixes, v4 `!` placement (suffix), raw black/white instead of theme
  classes.
- Table invariants: pagination not reset on search/page-size change, missing
  `getRowId`, cross-page selection broken.
- Date handling: UTC vs local drift in formatting or range boundaries.
- Inputs: missing guards on user-controlled values (length, format,
  numeric bounds), PII in logs, missing email preheader/text variants.
- Admin visuals: light-mode-only styling, hardcoded colors, focus states
  missing.
- API: hand-rolled response shapes instead of response-shapes.ts helpers;
  bare `Error` in packages/nextly; status codes inlined instead of
  error-code mappings.

## Merging

Default policy: the founder merges. Only merge yourself when the founder has
explicitly authorized it for the specific PR or program, and then only with
all CI checks green and every review thread resolved.
