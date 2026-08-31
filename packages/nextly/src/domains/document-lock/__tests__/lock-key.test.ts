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
    expect(documentLockKey("collection", "posts", "abc-123")).toBe(
      "collection:posts:abc-123"
    );
  });

  it("refuses a collection carrying the separator, which would collide with another document", () => {
    // "a:b" + "c" and "a" + "b:c" both read as "a:b:c". Escaping instead of
    // refusing would make the key unreadable in the database session where
    // somebody debugging "who holds this" actually looks.
    expect(documentLockKey("collection", "a:b", "c")).toBeUndefined();
    expect(documentLockKey("collection", "a", "b:c")).toBeUndefined();
  });

  it("refuses an empty half rather than producing a key with a hole in it", () => {
    expect(documentLockKey("collection", "", "abc")).toBeUndefined();
    expect(documentLockKey("collection", "posts", "")).toBeUndefined();
  });

  it("gives a Single and a collection entry with the same slug DIFFERENT keys", () => {
    // Their entries live in separate tables, so an id is unique only within its
    // own kind. One key for both would mean taking over the Single silently
    // released the collection entry, and each author would be told they held a
    // document the other was editing.
    expect(documentLockKey("single", "about", "1")).not.toBe(
      documentLockKey("collection", "about", "1")
    );
  });

  it("refuses a key MySQL could not index, at the boundary", () => {
    const prefix = "collection:posts:";
    const fits = "e".repeat(MAX_DOCUMENT_LOCK_KEY_LENGTH - prefix.length);
    expect(documentLockKey("collection", "posts", fits)).toHaveLength(
      MAX_DOCUMENT_LOCK_KEY_LENGTH
    );
    // One character more is refused rather than silently truncated: two entry
    // ids sharing a 191-character prefix would otherwise share a lock row.
    expect(documentLockKey("collection", "posts", `${fits}e`)).toBeUndefined();
  });
});
