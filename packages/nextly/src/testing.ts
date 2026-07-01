/**
 * `nextly/testing` — in-memory integration test harness (D46).
 *
 * Kept on a dedicated subpath so the native SQLite driver and boot machinery
 * stay out of the main `nextly` entry. Re-exported from
 * `@nextlyhq/plugin-sdk/testing` for plugin authors.
 *
 * @module testing
 */

export {
  createTestNextly,
  type CreateTestNextlyOptions,
  type TestNextly,
} from "./plugins/test-nextly";
