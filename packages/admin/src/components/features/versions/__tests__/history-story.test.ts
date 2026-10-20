/**
 * The history list as a story: pinned rows, folds, events between versions,
 * filters and the language being edited.
 */
import { describe, expect, it } from "vitest";

import type { DocumentEvent, VersionMeta } from "@admin/services/versionApi";

import {
  buildStory,
  loadedWindow,
  SHARED_PART,
  type HistoryFilter,
  type HistoryView,
  type StoryEntry,
} from "../history-story";

let clock = 0;
/** A time `minutes` after a fixed morning, so order is explicit. */
function at(minutes: number): string {
  return new Date(Date.UTC(2026, 9, 14, 9, minutes)).toISOString();
}

function version(
  versionNo: number,
  minutes: number,
  overrides: Partial<VersionMeta> = {}
): VersionMeta {
  return {
    id: `v${versionNo}`,
    versionNo,
    status: "draft",
    isAutosave: false,
    label: null,
    locale: "en",
    sourceVersionNo: null,
    createdBy: "u1",
    author: { kind: "person", id: "u1", name: "Ana" },
    createdAt: at(minutes),
    updatedAt: at(minutes),
    ...overrides,
  };
}

function event(
  kind: string,
  minutes: number,
  overrides: Partial<DocumentEvent> = {}
): DocumentEvent {
  clock += 1;
  return {
    id: `e${clock}`,
    kind,
    actorKind: "person",
    actorId: "u1",
    actorName: "Ana",
    occurredAt: at(minutes),
    fromState: null,
    toState: null,
    note: null,
    versionNo: null,
    payload: null,
    parts: [],
    ...overrides,
  };
}

/** Newest first, as the server returns both. */
function newestFirst<T extends { createdAt?: string; occurredAt?: string }>(
  items: T[]
): T[] {
  const time = (item: T) => item.createdAt ?? item.occurredAt ?? "";
  return [...items].sort((a, b) => (time(a) < time(b) ? 1 : -1));
}

function story(
  versions: VersionMeta[],
  events: DocumentEvent[] = [],
  {
    lifecycle = true,
    localized = true,
    view = { kind: "all" } as HistoryView,
    filter = "everything" as HistoryFilter,
  } = {}
) {
  return buildStory({
    versions: newestFirst(versions),
    events: newestFirst(events),
    lifecycle,
    localized,
    view,
    filter,
  });
}

/** Each row as a short label: `v3`, `v5[v4,v2]` for a fold, `e:kind`. */
function rows(entries: StoryEntry[]): string[] {
  return entries.map(entry => {
    if (entry.kind === "version") {
      const folded = entry.folded.map(v => `v${v.versionNo}`).join(",");
      return `v${entry.version.versionNo}${folded ? `[${folded}]` : ""}`;
    }
    return entry.kind === "removed" ? "removed" : `e:${entry.event.kind}`;
  });
}

function allRows(result: ReturnType<typeof story>): string[] {
  return result.days.flatMap(day => rows(day.entries));
}

describe("the story's folds", () => {
  it("folds each save under the next publish that included its part", () => {
    // English and Spanish saves interleaved, then a Spanish-only publish: the
    // Spanish saves ship with it, the English ones did not.
    const result = story(
      [
        version(1, 1, { locale: "en" }),
        version(2, 2, { locale: "es" }),
        version(3, 3, { locale: "en" }),
        version(4, 4, { locale: "es" }),
        version(5, 5, { locale: "es", status: "published" }),
      ],
      [event("published", 5, { versionNo: 5, parts: ["es"] })]
    );
    expect(allRows(result)).toEqual(["v5[v4,v2]", "v3", "v1"]);
  });

  it("never folds a named version or a restore", () => {
    const result = story(
      [
        version(1, 1),
        version(2, 2, { label: "Approved copy" }),
        version(3, 3, { sourceVersionNo: 1 }),
        version(4, 4, { status: "published" }),
      ],
      [event("published", 4, { versionNo: 4, parts: ["en"] })]
    );
    expect(allRows(result)).toEqual(["v4[v1]", "v3", "v2"]);
  });

  it("folds nothing without the Draft/Published lifecycle", () => {
    const result = story(
      [version(1, 1, { status: "published" }), version(2, 2)],
      [],
      { lifecycle: false }
    );
    expect(allRows(result)).toEqual(["v2", "v1"]);
  });
});

describe("events between versions", () => {
  it("shows the events that are not a version, where they happened", () => {
    const result = story(
      [version(1, 1), version(2, 5, { status: "published" })],
      [
        event("saved", 1, { versionNo: 1 }),
        event("named", 2, { versionNo: 1, payload: { label: "x" } }),
        event("draft-discarded", 3),
        event("unpublished", 4, { parts: ["en"] }),
        event("published", 5, { versionNo: 2, parts: ["en"] }),
        event("versions-removed", 6, { payload: { count: 3 } }),
      ]
    );
    // The save and the publish are their versions; the naming is shown on
    // its version. The rest are rows of their own.
    expect(allRows(result)).toEqual([
      "removed",
      "v2[v1]",
      "e:unpublished",
      "e:draft-discarded",
    ]);
  });

  it("shows a publish whose version is not in the list", () => {
    const result = story(
      [version(3, 3)],
      [event("published", 2, { versionNo: 1, parts: ["en"] })]
    );
    expect(allRows(result)).toEqual(["v3", "e:published"]);
  });
});

describe("filters", () => {
  const versions = [
    version(1, 1),
    version(2, 2, { label: "Launch copy" }),
    version(3, 3, { status: "published" }),
    version(4, 5),
  ];
  const events = [
    event("published", 3, { versionNo: 3, parts: ["en"] }),
    event("unpublished", 4, { parts: ["en"] }),
  ];
  const filtered = (filter: HistoryFilter) =>
    allRows(story(versions, events, { filter }));

  it("shows everything by default", () => {
    expect(filtered("everything")).toEqual([
      "v4",
      "e:unpublished",
      "v3[v1]",
      "v2",
    ]);
  });

  it("shows only publishes", () => {
    expect(filtered("published")).toEqual(["v3[v1]"]);
  });

  it("shows only named versions", () => {
    expect(filtered("named")).toEqual(["v2"]);
  });

  it("shows events and the versions that are more than a save", () => {
    expect(filtered("events")).toEqual(["e:unpublished", "v3[v1]", "v2"]);
  });
});

describe("the pinned rows", () => {
  it("pins a draft over a published version, and what is published", () => {
    const result = story(
      [version(1, 1, { status: "published" }), version(2, 2)],
      [event("published", 1, { versionNo: 1, parts: ["en"] })]
    );
    expect(result.drafts).toMatchObject([
      { part: "en", version: { versionNo: 2 }, published: true },
    ]);
    expect(result.published).toMatchObject([
      { parts: ["en"], version: { versionNo: 1 } },
    ]);
    expect(result.published[0]?.publishedBy?.actorName).toBe("Ana");
  });

  it("pins a draft of a document never published, and nothing published", () => {
    const result = story([version(1, 1), version(2, 2)]);
    expect(result.drafts).toMatchObject([
      { part: "en", version: { versionNo: 2 }, published: false },
    ]);
    expect(result.published).toEqual([]);
  });

  it("pins no draft once it was discarded, and a later draft again", () => {
    // A held draft saved, then discarded: its version stays in the history,
    // but it is no longer the document's draft.
    const discarded = story(
      [version(1, 1, { status: "published" }), version(2, 2)],
      [
        event("published", 1, { versionNo: 1, parts: ["en"] }),
        event("draft-discarded", 3, { parts: ["en"] }),
      ]
    );
    expect(discarded.drafts).toEqual([]);
    expect(discarded.published).toHaveLength(1);

    // A discard of another language leaves this one's draft pinned, and a
    // draft saved after the discard is pinned.
    const other = story(
      [version(1, 1, { status: "published" }), version(2, 2)],
      [
        event("published", 1, { versionNo: 1, parts: ["en"] }),
        event("draft-discarded", 3, { parts: ["es"] }),
      ]
    );
    expect(other.drafts).toMatchObject([{ version: { versionNo: 2 } }]);
    const later = story(
      [version(1, 1, { status: "published" }), version(2, 2), version(3, 4)],
      [
        event("published", 1, { versionNo: 1, parts: ["en"] }),
        event("draft-discarded", 3, { parts: ["en"] }),
      ]
    );
    expect(later.drafts).toMatchObject([{ version: { versionNo: 3 } }]);
  });

  it("pins no draft when the published version is the newest", () => {
    const result = story(
      [version(1, 1), version(2, 2, { status: "published" })],
      [event("published", 2, { versionNo: 2, parts: ["en"] })]
    );
    expect(result.drafts).toEqual([]);
    expect(result.published).toHaveLength(1);
  });

  it("pins nothing for history-only content with no lifecycle", () => {
    const result = story(
      [version(1, 1, { status: "published" }), version(2, 2)],
      [],
      { lifecycle: false }
    );
    expect(result.drafts).toEqual([]);
    expect(result.published).toEqual([]);
  });

  it("names no publisher for a publish made before events were recorded", () => {
    const result = story([version(1, 1, { status: "published" })]);
    expect(result.published).toMatchObject([
      { version: { versionNo: 1 }, publishedBy: null },
    ]);
  });

  it("names the publisher of a publish recorded without its number, in its version's second", () => {
    // A publish written in the version's own transaction shares its second;
    // some write paths record it without the version's number.
    const result = story(
      [version(1, 1, { status: "published" })],
      [event("published", 1, { versionNo: null, actorName: "Marta" })]
    );
    expect(result.published[0]?.publishedBy?.actorName).toBe("Marta");
    // Shown on its version, not again as a row of its own.
    expect(allRows(result)).toEqual(["v1"]);
  });

  it("counts a withdrawal in the publish's own second as after it", () => {
    const result = story(
      [version(1, 1, { status: "published" })],
      [event("unpublished", 1, { parts: [] })]
    );
    expect(result.published).toEqual([]);
  });

  it("pins nothing published once the part was withdrawn", () => {
    const result = story(
      [version(1, 1, { status: "published" })],
      [
        event("published", 1, { versionNo: 1, parts: ["en"] }),
        event("unpublished", 2, { parts: ["en"] }),
      ]
    );
    expect(result.published).toEqual([]);
  });

  it("shows a publish of several parts as one row naming them", () => {
    const result = story(
      [
        version(1, 1, { locale: "en" }),
        version(2, 2, { locale: "es" }),
        version(3, 3, { locale: "es", status: "published" }),
      ],
      [event("published", 3, { versionNo: 3, parts: ["en", "es"] })]
    );
    expect(result.published).toMatchObject([
      { parts: ["es", "en"], version: { versionNo: 3 } },
    ]);
  });

  it("pins a Spanish draft beside a shared-fields draft", () => {
    const result = story([
      version(1, 1, { locale: "es" }),
      version(2, 2, { locale: null }),
    ]);
    expect(result.drafts.map(d => d.part)).toEqual([SHARED_PART, "es"]);
  });
});

describe("a document without languages", () => {
  it("is one part, however its versions are tagged", () => {
    // Live saves tag the default language and held drafts none: one document.
    const result = story(
      [
        version(1, 1, { locale: null }),
        version(2, 2, { locale: "en", status: "published" }),
        version(3, 3, { locale: null }),
      ],
      [event("published", 2, { versionNo: 2, parts: ["en"] })],
      { localized: false }
    );
    expect(allRows(result)).toEqual(["v3", "v2[v1]"]);
    expect(result.drafts).toMatchObject([
      { version: { versionNo: 3 }, published: true },
    ]);
    expect(result.published).toMatchObject([{ version: { versionNo: 2 } }]);
  });
});

describe("the language being edited", () => {
  const versions = [
    version(1, 1, { locale: "en" }),
    version(2, 2, { locale: "es" }),
    version(3, 3, { locale: null }),
  ];

  it("shows Spanish and the shared fields when opened in Spanish", () => {
    const result = story(versions, [], {
      view: { kind: "language", locale: "es" },
    });
    expect(allRows(result)).toEqual(["v3", "v2"]);
  });

  it("shows every part with All languages", () => {
    expect(allRows(story(versions))).toEqual(["v3", "v2", "v1"]);
  });
});

describe("day headings", () => {
  it("groups entries by the day they happened, newest first", () => {
    const result = story([
      version(1, 1),
      version(2, 2, { createdAt: "2026-10-15T09:02:00.000Z" }),
    ]);
    expect(result.days.map(day => day.entries.length)).toEqual([1, 1]);
  });
});

describe("the loaded window", () => {
  it("cuts both lists to the newer floor of a list with more to load", () => {
    const versions = newestFirst([version(1, 1), version(2, 5)]);
    const events = newestFirst([event("unpublished", 3), event("x", 6)]);
    const both = loadedWindow({
      versions,
      versionsComplete: true,
      events,
      eventsComplete: false,
    });
    // Events stop at 09:03 with more to load, so version 1 (09:01) waits.
    expect(both.versions.map(v => v.versionNo)).toEqual([2]);
    expect(both.events.map(e => e.kind)).toEqual(["x", "unpublished"]);
  });

  it("keeps everything when both lists are complete", () => {
    const both = loadedWindow({
      versions: [version(1, 1)],
      versionsComplete: true,
      events: [event("unpublished", 3)],
      eventsComplete: true,
    });
    expect(both.versions).toHaveLength(1);
    expect(both.events).toHaveLength(1);
  });
});
