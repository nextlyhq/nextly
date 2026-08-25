/**
 * Whether the revision actually MOVES for each write that changes the preview.
 *
 * The pane test proves that a changed revision reloads the frame. It does that
 * by handing the component `"r1"` and then `"r2"`, which says nothing about
 * whether this function would ever have produced the second value — so the
 * writes themselves are exercised here, on documents shaped the way the server
 * really returns them.
 *
 * Every case needs TWO saves. One save cannot distinguish an implementation
 * that tracks the write from one that never updates at all, because both agree
 * on the first value.
 */
import { describe, expect, it } from "vitest";

import { previewRevisionOf } from "../previewRevision";

/** A published entry, as read before anyone edits it. */
const published = {
  id: "7",
  updatedAt: "2026-08-25T10:00:00.000Z",
};

/**
 * The same entry after a status-less save.
 *
 * `updatedAt` is UNCHANGED on purpose, and that is the whole point of these
 * cases rather than a shortcut in the fixture: the save writes the working-draft
 * sidecar and leaves the live row alone, and `shapeDraftForResponse` then copies
 * the live parent's timestamps onto the response. The document a client sees
 * after such a save carries the published row's `updatedAt`, every time.
 */
const draftSave = {
  ...published,
  _isWorkingDraft: true,
};

describe("previewRevisionOf across working-draft saves", () => {
  it("moves on the FIRST draft save of a published entry", () => {
    // Derivation alone is enough here: `_isWorkingDraft` flips false to true.
    expect(previewRevisionOf(published, 0)).not.toBe(
      previewRevisionOf(draftSave, 1)
    );
  });

  it("moves on the SECOND draft save, where both derived facts stand still", () => {
    /*
     * The regression this exists for. After the first save `_isWorkingDraft` is
     * already `true` and `updatedAt` is frozen at the published row's value, so
     * every later draft save changes the content and moves neither fact. A
     * revision built from the document alone is constant from here on and the
     * pane silently stops matching what the author is editing.
     */
    expect(previewRevisionOf(draftSave, 1)).not.toBe(
      previewRevisionOf(draftSave, 2)
    );
  });

  it("keeps moving across a run of draft saves", () => {
    const seen = [1, 2, 3, 4, 5].map(n => previewRevisionOf(draftSave, n));
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("previewRevisionOf on writes the form never announced", () => {
  it("moves when a working draft is discarded, with no save of its own", () => {
    /*
     * The other half of the union, and why the save count is not the whole
     * answer. Discarding persists through its own mutation: the count does not
     * move, `updatedAt` does not move — the draft is a separate row from the
     * published one — and only the flag going false says the frame is now
     * showing content that no longer exists.
     */
    expect(previewRevisionOf(draftSave, 3)).not.toBe(
      previewRevisionOf(published, 3)
    );
  });

  it("moves when a restore rewrites the live row under an unchanged count", () => {
    const restored = { ...published, updatedAt: "2026-08-25T11:30:00.000Z" };
    expect(previewRevisionOf(published, 3)).not.toBe(
      previewRevisionOf(restored, 3)
    );
  });
});

describe("previewRevisionOf reading the timestamp", () => {
  it("accepts the snake_case spelling the other read path returns", () => {
    // A reader that knew only one spelling returned "" for the other, which
    // compares equal to itself forever — the revision would stop moving rather
    // than fail loudly.
    const a = { updated_at: "2026-08-25T10:00:00.000Z" };
    const b = { updated_at: "2026-08-25T10:00:01.000Z" };
    expect(previewRevisionOf(a, 0)).not.toBe(previewRevisionOf(b, 0));
  });

  it("keeps sub-second precision, so two saves in one second differ", () => {
    // `String(new Date())` drops milliseconds, and these two would compare
    // equal under it.
    const a = { updatedAt: new Date("2026-08-25T10:00:00.100Z") };
    const b = { updatedAt: new Date("2026-08-25T10:00:00.900Z") };
    expect(previewRevisionOf(a, 0)).not.toBe(previewRevisionOf(b, 0));
  });

  it("survives a document that is missing entirely", () => {
    expect(() => previewRevisionOf(null, 0)).not.toThrow();
    expect(() => previewRevisionOf(undefined, 0)).not.toThrow();
  });
});
