/**
 * The key a document's lock row is addressed by.
 *
 * Every case here is about a document that CANNOT be locked. The key is derived
 * in one place precisely so a document that has no representable key is refused
 * once, loudly, rather than silently colliding with a different document's row —
 * which would present as one author's lock releasing another author's document.
 *
 * @module domains/document-lock/__tests__/lock-key.test
 */

import { describe, expect, it } from "vitest";

import { MAX_DOCUMENT_LOCK_KEY_LENGTH, documentLockKey } from "../lock-key";

describe("documentLockKey", () => {
  it("joins a collection and an entry id", () => {
    expect(documentLockKey("posts", "abc-123")).toBe("posts:abc-123");
  });

  it("refuses a collection carrying the separator, which would collide with another document", () => {
    // "a:b" + "c" and "a" + "b:c" both read as "a:b:c". Escaping instead of
    // refusing would make the key unreadable in the database session where
    // somebody debugging "who holds this" actually looks.
    expect(documentLockKey("a:b", "c")).toBeUndefined();
    expect(documentLockKey("a", "b:c")).toBeUndefined();
  });

  it("refuses an empty half rather than producing a key with a hole in it", () => {
    expect(documentLockKey("", "abc")).toBeUndefined();
    expect(documentLockKey("posts", "")).toBeUndefined();
  });

  it("refuses a key MySQL could not index, at the boundary", () => {
    const fits = "e".repeat(MAX_DOCUMENT_LOCK_KEY_LENGTH - "posts:".length);
    expect(documentLockKey("posts", fits)).toHaveLength(
      MAX_DOCUMENT_LOCK_KEY_LENGTH
    );
    // One character more is refused rather than silently truncated: two entry
    // ids sharing a 191-character prefix would otherwise share a lock row.
    expect(documentLockKey("posts", `${fits}e`)).toBeUndefined();
  });
});
