/**
 * What is said while a header or footer is edited in place, word for word as
 * decided: the bar, the announcements, the top bar's Save and Publish, both
 * questions and their answers, the lock's refusal.
 */
import { describe, expect, it } from "vitest";

import {
  BACK_TO_THE_PAGE,
  DISCARD,
  DONE,
  doneQuestion,
  editingWords,
  KEEP_EDITING,
  lockedBy,
  publishLabel,
  publishQuestion,
  publishToLabel,
  SAVE_AS_DRAFT,
  saveLabel,
  TRY_AGAIN,
} from "./region-editing-words";

const ELEVEN = { count: 11, complete: true };

describe("the words of editing a header in place", () => {
  it("says what is edited and how many pages it reaches", () => {
    expect(editingWords("header", ELEVEN, undefined)).toEqual({
      bar: "Editing the site header · changes show on 11 pages",
      entered: "Editing the site header. Changes show on 11 pages.",
    });
    expect(editingWords("footer", ELEVEN, undefined).bar).toBe(
      "Editing the site footer · changes show on 11 pages"
    );
  });

  it("says one page, and a floor while the count is not whole", () => {
    expect(
      editingWords("header", { count: 1, complete: true }, undefined).bar
    ).toBe("Editing the site header · changes show on 1 page");
    expect(
      editingWords("header", { count: 40, complete: false }, undefined).bar
    ).toBe("Editing the site header · changes show on at least 40 pages");
  });

  it("says when the latest version's unpublished changes were made", () => {
    const at = "2026-11-17T09:30:00.000Z";
    const when = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(at));
    expect(editingWords("header", ELEVEN, at).bar).toBe(
      `Editing the site header · changes show on 11 pages · Unpublished changes from ${when}`
    );
  });

  it("labels the top bar, the questions and their answers as decided", () => {
    expect(saveLabel("header")).toBe("Save header");
    expect(publishLabel("header")).toBe("Publish header");
    expect(publishQuestion("header", ELEVEN)).toBe(
      "Publish the header to 11 pages?"
    );
    expect(doneQuestion("header")).toBe("Publish your header changes?");
    expect(publishToLabel(ELEVEN)).toBe("Publish to 11 pages");
    expect([SAVE_AS_DRAFT, DISCARD, KEEP_EDITING, DONE, TRY_AGAIN]).toEqual([
      "Save as draft",
      "Discard",
      "Keep editing",
      "Done",
      "Try again",
    ]);
    expect(BACK_TO_THE_PAGE).toBe("Back to the page.");
  });

  it("names whoever holds the header", () => {
    expect(lockedBy("header", "Ana Diaz")).toBe(
      "Ana Diaz is editing this header. Try again when they're done."
    );
    expect(lockedBy("header", null)).toBe(
      "Someone is editing this header. Try again when they're done."
    );
  });
});
