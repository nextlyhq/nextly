/**
 * What Continue where you left off reads from its answer: the document each
 * row names and where it links, who saved it, its status label, whether it is
 * pinned, which tab the settings name, and the empty text per tab.
 */
import { describe, expect, it } from "vitest";

import {
  CHANGED,
  continueEmpty,
  continueRowFrom,
  continueRows,
  continueTab,
} from "./continue-model";

/** One row as `system:continue` answers it. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "save-1",
    entryId: "doc-1",
    entryTitle: "Doc 1",
    collection: "posts",
    subjectKind: "collection",
    icon: "Bookmark",
    locale: null,
    actorType: "user",
    userId: "user-ben",
    userName: "Ben",
    identityErasedAt: null,
    editedAt: "2026-10-22T12:00:00.000Z",
    status: "published",
    pendingChanges: false,
    pinned: false,
    ...overrides,
  };
}

describe("a Continue row", () => {
  it("names its document, links to it in the language it was saved in, and says who saved it", () => {
    expect(continueRowFrom(row({ locale: "fr" }))).toEqual({
      key: "save-1",
      title: "Doc 1",
      collection: "posts",
      icon: "Bookmark",
      href: "/admin/collections/posts/doc-1?locale=fr",
      savedBy: "Ben",
      editedAt: "2026-10-22T12:00:00.000Z",
      status: "Published",
      pinned: false,
      target: {
        targetType: "collection",
        targetSlug: "posts",
        entryId: "doc-1",
      },
    });
  });

  it("reads a pinned Single, which names no entry, as its own page", () => {
    const single = continueRowFrom(
      row({
        id: "pin-1",
        subjectKind: "single",
        collection: "home",
        entryId: "",
        userId: null,
        pinned: true,
      })
    );
    expect(single?.href).toBe("/admin/singles/home");
    expect(single?.collection).toBeUndefined();
    expect(single?.savedBy).toBeUndefined();
    expect(single?.pinned).toBe(true);
    expect(single?.target).toEqual({
      targetType: "single",
      targetSlug: "home",
    });
  });

  it("labels a held draft as Changed before its status", () => {
    expect(continueRowFrom(row({ pendingChanges: true }))?.status).toBe(
      CHANGED
    );
    expect(continueRowFrom(row({ status: "scheduled" }))?.status).toBe(
      "Scheduled"
    );
  });

  it("is left out without a title, never named by its id", () => {
    // 🔴 The source titles every document the reader may read; a row without
    // one is not drawn under a stand-in.
    expect(continueRowFrom(row({ entryTitle: null }))).toBeUndefined();
    expect(continueRowFrom(row({ entryTitle: "" }))).toBeUndefined();
    // An entry's row without its id cannot link, and is left out too.
    expect(continueRowFrom(row({ entryId: null }))).toBeUndefined();
  });

  it("keeps the answer's order, leaving out what it cannot read", () => {
    const rows = continueRows({
      op: "list",
      items: [
        row({ id: "pin-a", entryTitle: "A", pinned: true }),
        row({ id: "broken", entryTitle: null }),
        row({ id: "save-b", entryTitle: "B" }),
      ],
    });
    expect(rows.map(each => each.key)).toEqual(["pin-a", "save-b"]);
  });
});

describe("the card's tab and empty text", () => {
  it("is Mine unless the settings say Team", () => {
    expect(continueTab({})).toBe("mine");
    expect(continueTab({ tab: "mine" })).toBe("mine");
    expect(continueTab({ tab: "team" })).toBe("team");
    expect(continueTab({ tab: "everyone" })).toBe("mine");
  });

  it("says what fills Mine, and how far back Team looked", () => {
    const empty = { op: "list" as const, items: [] };
    expect(continueEmpty("mine", empty).title).toBe("Nothing to continue yet");
    expect(continueEmpty("team", empty).title).toBe("No edits by others yet");
    expect(continueEmpty("team", { ...empty, window: { days: 1 } }).title).toBe(
      "No edits by others in the last day"
    );
    expect(
      continueEmpty("team", { ...empty, window: { days: 90 } }).title
    ).toBe("No edits by others in the last 90 days");
  });
});
