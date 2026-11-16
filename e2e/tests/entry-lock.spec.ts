/**
 * Two people and one entry: the collection entry editor keeps the document's
 * soft lock.
 *
 * The second person sees the entry read-only, named as held by the first, and
 * can ask for access; a takeover moves the entry to them, and the first
 * person's unsaved edit is still theirs, on screen, for when they take it back
 * (`support/lock-cases`). Each test writes a post of its own, so nothing here
 * shares a document with another spec.
 *
 * @module tests/entry-lock
 */
import { test } from "./support/test";
import { EVERY_DIALECT } from "./support/every-dialect";
import {
  secondEditorFindsItHeld,
  takeoverKeepsUnsavedEdits,
} from "./support/lock-cases";
import { LOCKED_POST as POST } from "./support/locked-post";
import { LOCK } from "./support/locks";

// Creates a second editor's account; see support/locks.ts for what each lock
// guards.
test.describe.configure({ lock: [LOCK.usersRoles] });

// Run on every dialect: the lease the two editors share lives in the database.
test.describe("two editors on one entry", { tag: EVERY_DIALECT }, () => {
  // Two sessions, and a lock heartbeat each side waits on: the holder learns
  // of a request, and the displaced editor of a takeover, only at its next
  // beat, which the cases allow 45 seconds for.
  test.describe.configure({ timeout: 120_000 });

  test("a second editor sees the entry read-only and named, and can ask for access", async ({
    page,
    browser,
    baseURL,
  }) => {
    await secondEditorFindsItHeld(POST, { page, browser, baseURL });
  });

  test("a takeover keeps the displaced editor's unsaved edits", async ({
    page,
    browser,
    baseURL,
  }) => {
    await takeoverKeepsUnsavedEdits(POST, { page, browser, baseURL });
  });
});
