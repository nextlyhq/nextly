/**
 * Which writes a reader's held editor still sends: a publish and an
 * unpublish, each as the status alone, and only once the answer refusing
 * them the update is settled and nothing else holds the document.
 */
import { describe, expect, it } from "vitest";

import { readerStatusWrite, statusWritesHeld } from "../reader-status-write";
import type { EntryFormIntent } from "../useEntryForm";

const READER = { refused: true, writesHeld: false };

describe("readerStatusWrite", () => {
  it("publishes and unpublishes a reader's document by its status", () => {
    expect(readerStatusWrite("publish", READER)).toBe("published");
    expect(readerStatusWrite("unpublish", READER)).toBe("draft");
  });

  it("sends no other intent: each would change the content", () => {
    const edits: (EntryFormIntent | undefined)[] = [
      "save-draft",
      "save-working-draft",
      "save-changes",
      undefined,
    ];
    for (const intent of edits) {
      expect(readerStatusWrite(intent, READER)).toBeUndefined();
    }
  });

  it("sends nothing while the document is held for another reason", () => {
    // A colleague's claim, or a past version on screen.
    expect(
      readerStatusWrite("publish", { refused: true, writesHeld: true })
    ).toBeUndefined();
  });

  it("sends nothing before the update's refusal is settled", () => {
    // While a language switch's answer is on its way the update is held,
    // not refused: nothing is written on the old language's word.
    expect(
      readerStatusWrite("publish", { refused: false, writesHeld: false })
    ).toBeUndefined();
  });
});

describe("statusWritesHeld", () => {
  it("holds a status write as the edits are, except for a settled reader", () => {
    const held = (editsHeld: boolean, refused: boolean, writesHeld: boolean) =>
      statusWritesHeld({ editsHeld, refused, writesHeld });
    // An editor: nothing held.
    expect(held(false, false, false)).toBe(false);
    // A settled reader, nothing else holding the document: offered.
    expect(held(true, true, false)).toBe(false);
    // A reader's document held otherwise, or the answer not settled: held.
    expect(held(true, true, true)).toBe(true);
    expect(held(true, false, false)).toBe(true);
  });
});
