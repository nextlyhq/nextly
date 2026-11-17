/**
 * What Continue where you left off reads from its answer: the document each
 * row names and where it links, who saved it, its status label, whether it is
 * pinned, which tab the settings name, and the empty text per tab.
 */
import type { CoreListWidgetData } from "nextly/core-widget-data";
import { describe, expect, it } from "vitest";

import { documentAddress } from "@admin/lib/navigation/document-address";
import type { DocumentAddressOf } from "@admin/lib/navigation/useDocumentAddress";

import {
  CHANGED,
  continueEmpty,
  continueRowFrom,
  continueRows,
  continueSections,
  continueTab,
} from "./continue-model";

/** The shared rule with no collection known: every row opens its form. */
const formAddress: DocumentAddressOf = (document, options = {}) =>
  documentAddress(
    document,
    undefined,
    { canUpdate: true, defaultLocale: "en", ...options },
    []
  );

/** One row of the card's data, as JSON carries it. */
type Row = CoreListWidgetData["items"][number];

/** One row as `system:continue` answers it. */
function row(overrides: Row = {}): Row {
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
    expect(continueRowFrom(row({ locale: "fr" }), formAddress)).toEqual({
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
      }),
      formAddress
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
    expect(
      continueRowFrom(row({ pendingChanges: true }), formAddress)?.status
    ).toBe(CHANGED);
    expect(
      continueRowFrom(row({ status: "scheduled" }), formAddress)?.status
    ).toBe("Scheduled");
  });

  it("is left out without a title, never named by its id", () => {
    // 🔴 The source titles every document the reader may read; a row without
    // one is not drawn under a stand-in.
    expect(
      continueRowFrom(row({ entryTitle: null }), formAddress)
    ).toBeUndefined();
    expect(
      continueRowFrom(row({ entryTitle: "" }), formAddress)
    ).toBeUndefined();
    // An entry's row without its id cannot link, and is left out too.
    expect(
      continueRowFrom(row({ entryId: null }), formAddress)
    ).toBeUndefined();
  });

  it("keeps the answer's order, leaving out what it cannot read", () => {
    const rows = continueRows(
      {
        items: [
          row({ id: "pin-a", entryTitle: "A", pinned: true }),
          row({ id: "broken", entryTitle: null }),
          row({ id: "save-b", entryTitle: "B" }),
        ],
      },
      formAddress
    );
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
    const empty = { items: [] };
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

describe("where a Continue row opens", () => {
  // The shared rule over one collection whose main field is a view's field
  // type, as the card's hook reads it from the admin's list of collections.
  const pageAddress: DocumentAddressOf = (document, options = {}) =>
    documentAddress(
      document,
      {
        fields: [
          { name: "title", type: "text" },
          { name: "content", type: "blocks" },
        ],
      },
      { canUpdate: true, defaultLocale: "en", ...options },
      [
        {
          fieldType: "blocks",
          path: "builder",
          component: "@acme/builder#View",
          opensFirst: "mainField",
        },
      ]
    );

  it("opens where every other link to the document opens", () => {
    expect(
      continueRowFrom(row({ collection: "pages" }), pageAddress)?.href
    ).toBe("/admin/collections/pages/doc-1/builder?field=content");
    // Saved in another language: the form, in that language.
    expect(
      continueRowFrom(row({ collection: "pages", locale: "fr" }), pageAddress)
        ?.href
    ).toBe("/admin/collections/pages/doc-1?locale=fr");
  });
});

describe("Mine's groups", () => {
  /** `count` pinned rows, newest first, of `total` pins in all, as the source sends them. */
  const pinned = (count: number, total = count): Row[] =>
    Array.from({ length: count }, (_, i) =>
      row({
        id: `pin-${i + 1}`,
        entryId: `pin-${i + 1}`,
        entryTitle: `Pin ${i + 1}`,
        userId: null,
        pinned: true,
        group: "pinned",
        pinCount: total,
      })
    );
  /** `count` recent saves, newest first. */
  const recent = (count: number): Row[] =>
    Array.from({ length: count }, (_, i) =>
      row({
        id: `save-${i + 1}`,
        entryId: `save-${i + 1}`,
        entryTitle: `Save ${i + 1}`,
        group: "recent",
      })
    );
  const sectionsOf = (items: Row[], drawn = 5) =>
    continueSections(continueRows({ items }, formAddress), drawn);
  const titles = (rows: readonly { title: string }[]) =>
    rows.map(each => each.title);

  it("has none while there are no pins, so Mine is one plain list", () => {
    expect(sectionsOf(recent(6))).toBeUndefined();
    // A server before the groups sends none: one plain list too.
    expect(sectionsOf([row(), row({ id: "save-2" })])).toBeUndefined();
  });

  it.each([
    // pins sent, of how many in all, saves sent: what the card's five rows draw.
    [1, 1, 5, ["Pin 1"], ["Save 1", "Save 2", "Save 3", "Save 4"]],
    [3, 3, 3, ["Pin 1", "Pin 2", "Pin 3"], ["Save 1", "Save 2"]],
    [3, 4, 3, ["Pin 1", "Pin 2", "Pin 3"], ["Save 1", "Save 2"]],
    [3, 7, 3, ["Pin 1", "Pin 2", "Pin 3"], ["Save 1", "Save 2"]],
    [6, 7, 0, ["Pin 1", "Pin 2", "Pin 3", "Pin 4", "Pin 5"], []],
  ] as const)(
    "draws %i pins of %i, newest first, then the recent saves, in the card's rows",
    (sent, total, saves, pins, saved) => {
      const sections = sectionsOf([...pinned(sent, total), ...recent(saves)]);
      expect(titles(sections!.pinned)).toEqual(pins);
      expect(titles(sections!.recent)).toEqual(saved);
      expect(sections!.pinTotal).toBe(total);
    }
  );

  it("counts the pins it draws when the answer says no total", () => {
    const items = pinned(2).map(({ pinCount: _count, ...rest }) => rest);
    expect(sectionsOf(items)!.pinTotal).toBe(2);
  });

  it("reads each row's group and count, and leaves out a group it does not know", () => {
    const [pin, odd] = continueRows(
      {
        items: [
          ...pinned(1, 7),
          row({ id: "odd", group: "starred", pinCount: "7" }),
        ],
      },
      formAddress
    );
    expect(pin).toMatchObject({ group: "pinned", pinCount: 7 });
    expect(odd).not.toHaveProperty("group");
    expect(odd).not.toHaveProperty("pinCount");
  });
});
