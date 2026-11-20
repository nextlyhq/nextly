/**
 * Which part's draft each of a document's keys belongs to (`partKeysOf`).
 *
 * An unnamed group only arranges the form: its children are stored at the
 * level it sits in, so each one is a key of the document and belongs to a part
 * as any top-level field does. Classifying only named top-level fields would
 * leave those keys in neither draft, and a held edit to one would be lost.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  _resetPerLanguageStorage,
  setPerLanguageStorage,
} from "../../i18n/per-language-storage";
import {
  combinedDraft,
  draftSlotParts,
  partKeysOf,
  partsWritten,
  storePartDrafts,
} from "../part-drafts";
import type { VersionRow, VersionsRepository } from "../versions-repository";

describe("partKeysOf", () => {
  it("classifies the fields of an unnamed group into their parts", async () => {
    const details = {
      type: "group",
      fields: [
        { type: "number", name: "rank" },
        { type: "text", name: "caption" },
      ],
    };
    const keys = await partKeysOf([{ type: "text", name: "title" }, details]);

    expect([...keys.language].sort()).toEqual(["caption", "title"]);
    expect([...keys.shared].sort()).toEqual(["rank", "slug"]);
  });

  it("keeps a named group as one key of its own", async () => {
    const meta = {
      type: "group",
      name: "meta",
      fields: [{ type: "number", name: "weight" }],
    };
    const keys = await partKeysOf([{ type: "number", name: "views" }, meta]);

    // The group's value is one stored key; its children are not top-level.
    expect([...keys.language, ...keys.shared].sort()).toEqual([
      "meta",
      "slug",
      "title",
      "views",
    ]);
  });

  // A draft's part follows where the value is stored. A named group or
  // repeater is stored whole on the shared row, a component inside it
  // included, so its key is the shared draft's: a publish of it writes the
  // shared row, and every language shows it.
  it("keeps a named container that holds a component in the shared part, where it is stored", async () => {
    const layout = {
      type: "group",
      name: "layout",
      fields: [{ type: "component", name: "hero", component: "hero" }],
    };
    const items = {
      type: "repeater",
      name: "items",
      fields: [
        {
          type: "group",
          name: "inner",
          fields: [{ type: "component", name: "cta", component: "cta" }],
        },
      ],
    };
    const stats = {
      type: "group",
      name: "stats",
      fields: [{ type: "number", name: "views" }],
    };
    const keys = await partKeysOf([layout, items, stats]);

    expect([...keys.language]).toEqual([]);
    expect([...keys.shared].sort()).toEqual([
      "items",
      "layout",
      "slug",
      "stats",
      "title",
    ]);
  });

  // Every collection's entries carry a system `title` and `slug`, stored on
  // the shared row and left out of the stored field list. Undeclared, they are
  // the shared draft's, so a held edit to one is kept; declared, the
  // declaration decides.
  it("keeps the system title and slug in the shared part unless they are declared", async () => {
    const undeclared = await partKeysOf([{ type: "text", name: "body" }]);
    expect([...undeclared.language]).toEqual(["body"]);
    expect([...undeclared.shared].sort()).toEqual(["slug", "title"]);

    const declared = await partKeysOf([
      { type: "text", name: "title" },
      { type: "text", name: "body" },
    ]);
    expect([...declared.language].sort()).toEqual(["body", "title"]);
    expect([...declared.shared]).toEqual(["slug"]);
  });
});

/**
 * The parts a write records on its version (`partsWritten`), from the keys it
 * set: a language only for its own keys or its own status, the shared part
 * only for a shared key, and a write under no language always the one shared
 * part.
 */
describe("partsWritten", () => {
  const keys = {
    language: new Set(["title"]),
    shared: new Set(["views", "slug"]),
    structured: new Map(),
  };

  it("names the language of a held save that set a translated value, and not the shared part", () => {
    expect(
      partsWritten({ locale: "es", touched: new Set(["title"]), keys })
    ).toEqual({ locales: ["es"], shared: false });
  });

  it("names only the shared part for a held save in a language that set a shared value alone", () => {
    expect(
      partsWritten({ locale: "es", touched: new Set(["views"]), keys })
    ).toEqual({ locales: [], shared: true });
  });

  it("names no language for a write that set a shared value and not the language's status", () => {
    expect(
      partsWritten({
        locale: "es",
        touched: new Set(["views", "updatedAt"]),
        keys,
        statusWritten: false,
      })
    ).toEqual({ locales: [], shared: true });
  });

  it("names the language of a write that set no value of it but its status, as a publish by status alone", () => {
    expect(
      partsWritten({
        locale: "es",
        touched: new Set(["status", "updatedAt"]),
        keys,
        statusWritten: true,
      })
    ).toEqual({ locales: ["es"], shared: false });
  });

  it("names the shared part for a write of the document's own status", () => {
    expect(
      partsWritten({
        locale: "en",
        touched: new Set(["status"]),
        keys,
        statusWritten: true,
        documentStatusWritten: true,
      })
    ).toEqual({ locales: ["en"], shared: true });
  });

  it("names the shared part alone for a write under no language, whatever it set", () => {
    expect(
      partsWritten({ locale: null, touched: new Set(["title"]), keys })
    ).toEqual({ locales: [], shared: true });
  });
});

/**
 * A document that keeps no translations of its own stores every field on its
 * shared row; only its components, kept per language whatever their parent,
 * belong to a language.
 */
describe("partKeysOf, for a document without translations of its own", () => {
  it("puts its own fields in the shared part and its components in the language", async () => {
    const banner = { type: "component", name: "banner", component: "banner" };
    const keys = await partKeysOf([{ type: "text", name: "title" }, banner], {
      translated: false,
    });

    expect([...keys.language]).toEqual(["banner"]);
    expect([...keys.shared].sort()).toEqual(["slug", "title"]);
  });
});

/** The part a working draft's row records, by the slot it is kept under. */
describe("draftSlotParts", () => {
  afterEach(() => _resetPerLanguageStorage());

  it("names the shared part for the shared draft", () => {
    setPerLanguageStorage(true);
    expect(draftSlotParts(null)).toEqual({ locales: [], shared: true });
  });

  it("names the language alone for a language's draft kept by part", () => {
    setPerLanguageStorage(true);
    expect(draftSlotParts("es")).toEqual({ locales: ["es"], shared: false });
  });

  it("names the language and the shared part for a whole document kept in one language", () => {
    setPerLanguageStorage(false);
    expect(draftSlotParts("es")).toEqual({ locales: ["es"], shared: true });
  });
});

/**
 * A repeater or group that keeps one structure across languages is held by both parts: its
 * structure (rows, ids, order, shared values) by the shared part, the text inside by each
 * language, keyed by row id. The broken implementations these separate: the field filed whole in
 * one part (a translation starting a shared draft, or a reorder held for one language alone), a
 * language's draft keeping its own copy of the structure, and the shared draft carrying the text
 * of the language that saved it.
 */
describe("a structured field's shares", () => {
  const slides = {
    type: "repeater",
    name: "slides",
    fields: [
      { type: "text", name: "caption" },
      { type: "number", name: "rank" },
    ],
  };
  const live = {
    slides: [
      { id: "r1", caption: "primero", rank: 1 },
      { id: "r2", caption: "segundo", rank: 2 },
    ],
  };
  const row = (snapshot: Record<string, unknown>) =>
    ({ snapshot }) as unknown as VersionRow;

  it("files a repeater holding text in neither whole part, with what it translates inside", async () => {
    const keys = await partKeysOf([{ type: "text", name: "title" }, slides]);

    expect([...keys.structured.keys()]).toEqual(["slides"]);
    expect(keys.structured.get("slides")).toMatchObject({
      kind: "repeater",
      texts: ["caption"],
    });
    expect([...keys.language]).toEqual(["title"]);
    expect([...keys.shared].sort()).toEqual(["slug"]);
  });

  it("keeps the repeater whole in the shared part of a document without translations", async () => {
    const keys = await partKeysOf([slides], { translated: false });

    expect(keys.structured.size).toBe(0);
    expect([...keys.shared]).toContain("slides");
  });

  it("names the language alone for a changed caption, the shared part alone for a reorder", async () => {
    const keys = await partKeysOf([slides]);
    const touched = new Set(["slides"]);

    expect(
      partsWritten({
        locale: "es",
        touched,
        keys,
        values: {
          before: live,
          after: {
            slides: [
              { id: "r1", caption: "primero 2", rank: 1 },
              { id: "r2", caption: "segundo", rank: 2 },
            ],
          },
        },
      })
    ).toEqual({ locales: ["es"], shared: false });
    expect(
      partsWritten({
        locale: "es",
        touched,
        keys,
        values: {
          before: live,
          after: { slides: [...live.slides].reverse() },
        },
      })
    ).toEqual({ locales: [], shared: true });
    // A blank and an absent value read alike: nothing changed.
    expect(
      partsWritten({
        locale: "es",
        touched,
        keys,
        values: {
          before: { slides: [{ id: "r1", caption: null, rank: 1 }] },
          after: { slides: [{ id: "r1", rank: 1 }] },
        },
      })
    ).toEqual({ locales: [], shared: false });
    // Without the values to judge by, both shares count as changed.
    expect(partsWritten({ locale: "es", touched, keys })).toEqual({
      locales: ["es"],
      shared: true,
    });
  });

  it("lays a language's held text on the shared draft's structure, each row by its id", async () => {
    const keys = await partKeysOf([slides]);
    const combined = combinedDraft(
      {},
      {
        shared: row({
          slides: [
            { id: "r2", rank: 20 },
            { id: "r1", rank: 1 },
          ],
        }),
        language: row({ slides: { r1: { caption: "primero 2" } } }),
      },
      { keys, live }
    );

    // The held order and shared value; the held text on its own row, the live text on the other.
    expect(combined.slides).toEqual([
      { id: "r2", caption: "segundo", rank: 20 },
      { id: "r1", caption: "primero 2", rank: 1 },
    ]);
  });

  it("lays a language's held text on the live structure, never on a copy of its own", async () => {
    const keys = await partKeysOf([slides]);
    const reordered = { slides: [...live.slides].reverse() };
    const combined = combinedDraft(
      {},
      { language: row({ slides: { r1: { caption: "primero 2" } } }) },
      { keys, live: reordered }
    );

    expect(combined.slides).toEqual([
      { id: "r2", caption: "segundo", rank: 2 },
      { id: "r1", caption: "primero 2", rank: 1 },
    ]);
  });

  it("leaves out a language's held text with no structure to lay it on", async () => {
    const keys = await partKeysOf([slides]);
    const combined = combinedDraft(
      {},
      { language: row({ slides: { r1: { caption: "primero 2" } } }) },
      { keys, live: {} }
    );

    expect(combined).not.toHaveProperty("slides");
  });

  /** A versions store that records the drafts written to it, by slot. */
  function recordingRepo() {
    const written = new Map<string | null, Record<string, unknown>>();
    const repo = {
      upsertWorkingDraft: (draft: {
        locale: string | null;
        snapshot: Record<string, unknown>;
      }) => {
        written.set(draft.locale, draft.snapshot);
        return Promise.resolve();
      },
    } as unknown as VersionsRepository;
    return { repo, written };
  }

  it("stores a held caption in the language's draft alone, keyed by row id", async () => {
    const keys = await partKeysOf([slides]);
    const { repo, written } = recordingRepo();

    await storePartDrafts(repo, {
      ref: { scopeKind: "single", scopeSlug: "site", entryId: "1" },
      locale: "es",
      document: {
        slides: [
          { id: "r1", caption: "primero 2", rank: 1 },
          { id: "r2", caption: "segundo", rank: 2 },
        ],
      },
      before: live,
      touched: new Set(["slides"]),
      keys,
      existing: {},
    });

    expect([...written.keys()]).toEqual(["es"]);
    expect(written.get("es")).toEqual({
      slides: { r1: { caption: "primero 2" }, r2: { caption: "segundo" } },
    });
  });

  it("stores a held reorder in the shared draft alone, as structure without any text", async () => {
    const keys = await partKeysOf([slides]);
    const { repo, written } = recordingRepo();

    await storePartDrafts(repo, {
      ref: { scopeKind: "single", scopeSlug: "site", entryId: "1" },
      locale: "es",
      document: { slides: [...live.slides].reverse() },
      before: live,
      touched: new Set(["slides"]),
      keys,
      existing: {},
    });

    expect([...written.keys()]).toEqual([null]);
    expect(written.get(null)).toEqual({
      slides: [
        { id: "r2", rank: 2 },
        { id: "r1", rank: 1 },
      ],
    });
  });
});
