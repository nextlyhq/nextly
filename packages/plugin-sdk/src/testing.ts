/**
 * @nextlyhq/plugin-sdk/testing — the in-memory integration harness (D46).
 *
 * Re-exports `createTestNextly` from `nextly/testing` so plugin authors can
 * boot a real Nextly on in-memory SQLite and integration-test their plugin's
 * lifecycle, hooks, and events.
 *
 * @public Graduated in P9 — exercised by every first-party plugin's test suite
 *   (D46). See `STABILITY.md`.
 */
export {
  createTestNextly,
  type CreateTestNextlyOptions,
  type TestNextly,
} from "nextly/testing";
