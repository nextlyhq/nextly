/**
 * The branch pull requests merge into, and the ref local tooling compares a
 * working branch with.
 *
 * Pull requests merge into `dev`, which is promoted to `main` once a day when
 * its CI is green; releases are cut from `main`. So the day-to-day questions
 * ("what does this branch change?", "where does a new branch start?", "is this
 * work already merged?") are asked against `dev`, and only the release tooling
 * reads `main`.
 *
 * One home for the answer: the scripts that default a base import it, and
 * `integration-branch.test.mjs` holds the copies that cannot import it (the
 * pre-push hook, the root `fallow:audit` script, `.claude/settings.json`) to
 * the same value.
 *
 * @module scripts/integration-branch
 */

/** The branch every pull request targets. */
export const INTEGRATION_BRANCH = "dev";

/** Its remote-tracking ref, the default base of every local diff. */
export const INTEGRATION_BASE = `origin/${INTEGRATION_BRANCH}`;
