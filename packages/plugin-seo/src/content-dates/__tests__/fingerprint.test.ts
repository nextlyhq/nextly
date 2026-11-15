/**
 * The fingerprint of a page's published content: what a sitemap date moves
 * on. It changes with what a visitor sees, and with nothing else: not the
 * page's SEO, not Nextly's bookkeeping, not the order a read gives keys in.
 */
import { describe, expect, it } from "vitest";

import { contentFingerprint, earlierContentFingerprints } from "../fingerprint";

const PAGE = {
  id: "p1",
  title: "Pricing",
  slug: "pricing",
  body: { root: { children: [{ type: "text", text: "Plans" }] } },
  price: 10.5,
  tags: ["a", "b"],
  status: "published",
  createdAt: "2026-11-01T09:00:00.000Z",
  updatedAt: "2026-11-02T09:00:00.000Z",
  seo: { metaTitle: "Our prices" },
};

describe("a page's content fingerprint", () => {
  it("is the same for the same content however its keys are ordered", () => {
    const reordered = Object.fromEntries(Object.entries(PAGE).reverse());
    expect(contentFingerprint(reordered)).toBe(contentFingerprint(PAGE));
    expect(
      contentFingerprint({
        ...PAGE,
        body: { root: { children: [{ text: "Plans", type: "text" }] } },
      })
    ).toBe(contentFingerprint(PAGE));
  });

  it("is the same for a number however it is written, and a date as a date or its text", () => {
    expect(contentFingerprint({ ...PAGE, price: 10.5 })).toBe(
      contentFingerprint({ ...PAGE, price: 10.5 })
    );
    expect(contentFingerprint({ ...PAGE, price: 1 })).toBe(
      contentFingerprint({ ...PAGE, price: 1.0 })
    );
    expect(
      contentFingerprint({
        ...PAGE,
        publishedAt: new Date(Date.UTC(2026, 10, 1)),
      })
    ).toBe(
      contentFingerprint({ ...PAGE, publishedAt: "2026-11-01T00:00:00.000Z" })
    );
  });

  it("ignores the page's SEO and Nextly's bookkeeping", () => {
    const base = contentFingerprint(PAGE);
    expect(
      contentFingerprint({ ...PAGE, seo: { metaTitle: "Something else" } })
    ).toBe(base);
    expect(
      contentFingerprint({
        ...PAGE,
        updatedAt: "2026-11-13T10:00:00.000Z",
        createdAt: "2026-11-13T10:00:00.000Z",
        _rev: "7",
        _isWorkingDraft: false,
        status: "draft",
      })
    ).toBe(base);
  });

  it("ignores the stamps as a save hook is handed them, by their column names", () => {
    const stored = {
      id: "p1",
      title: "Pricing",
      created_at: "2026-11-01T09:00:00.000Z",
      updated_at: "2026-11-02T09:00:00.000Z",
      created_by: null,
      first_published_at: "2026-11-01T09:00:00.000Z",
      status: "published",
      _revision: 1,
      seo: '{"noindex":false}',
    };
    expect(
      contentFingerprint({
        ...stored,
        updated_at: "2026-11-13T09:00:00.000Z",
        created_by: "u1",
        updated_by: "u2",
        first_published_at: "2026-11-13T09:00:00.000Z",
        _revision: 2,
        seo: '{"metaTitle":"Our prices"}',
      })
    ).toBe(contentFingerprint(stored));
    expect(
      contentFingerprint({ ...PAGE, createdBy: "u1", firstPublishedAt: "x" })
    ).toBe(contentFingerprint(PAGE));
  });

  it("treats a field read back empty as one not read", () => {
    expect(contentFingerprint({ ...PAGE, subtitle: null })).toBe(
      contentFingerprint(PAGE)
    );
  });

  it("names another document read with the page by its id alone", () => {
    const author = {
      id: "a1",
      name: "Sara",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    };
    expect(
      contentFingerprint({
        ...PAGE,
        author: { ...author, updatedAt: "2026-11-13T00:00:00.000Z" },
      })
    ).toBe(contentFingerprint({ ...PAGE, author }));
    expect(
      contentFingerprint({ ...PAGE, author: { ...author, id: "a2" } })
    ).not.toBe(contentFingerprint({ ...PAGE, author }));
  });

  it("ignores a field group row's own id and stamps, which a save that changes none of its values rewrites", () => {
    // As the published read gives a field group's rows: each with the id and
    // the column-named stamps it is stored under.
    const row = {
      id: "r1",
      created_at: "2026-11-01T09:00:00.000Z",
      updated_at: "2026-11-01T09:00:00.000Z",
      heading: "Plans",
    };
    const page = { ...PAGE, hero: row, cards: [row, { ...row, id: "r2" }] };
    // Updated in place: its stamp moves.
    const touched = { ...row, updated_at: "2026-11-13T10:00:00.000Z" };
    // Stored again under a new id, as a repeatable group's item sent without
    // its id is.
    const renewed = {
      ...row,
      id: "r9",
      created_at: "2026-11-13T10:00:00.000Z",
      updated_at: "2026-11-13T10:00:00.000Z",
    };
    expect(
      contentFingerprint({
        ...page,
        hero: touched,
        cards: [renewed, { ...renewed, id: "r10" }],
      })
    ).toBe(contentFingerprint(page));
    // Its values are content.
    expect(
      contentFingerprint({ ...page, hero: { ...row, heading: "Prices" } })
    ).not.toBe(contentFingerprint(page));
  });

  it("keeps an id that names what the content links to", () => {
    const linked = (id: string) => ({
      ...PAGE,
      body: {
        root: {
          children: [{ type: "relationship", value: { id }, relationTo: "x" }],
        },
      },
    });
    expect(contentFingerprint(linked("d1"))).not.toBe(
      contentFingerprint(linked("d2"))
    );
  });

  it.each([
    ["the title", { title: "Prices" }],
    ["the address", { slug: "prices" }],
    [
      "the body",
      { body: { root: { children: [{ type: "text", text: "Plan" }] } } },
    ],
    ["a number", { price: 11 }],
    ["a list's order", { tags: ["b", "a"] }],
    ["a repeater item's own text", { faq: [{ id: "q1", question: "Why?" }] }],
  ])("changes with %s", (_, change) => {
    expect(contentFingerprint({ ...PAGE, ...change })).not.toBe(
      contentFingerprint(PAGE)
    );
  });

  it("recognises the fingerprint the previous release kept for a page with field groups", () => {
    const page = {
      id: "p1",
      title: "Pricing",
      status: "published",
      createdAt: "2026-11-01T09:00:00.000Z",
      updatedAt: "2026-11-02T09:00:00.000Z",
      seo: { metaTitle: "Our prices" },
      hero: {
        id: "r1",
        created_at: "2026-11-01T09:00:00.000Z",
        updated_at: "2026-11-01T09:00:00.000Z",
        heading: "Plans",
      },
      cards: [
        {
          id: "r2",
          created_at: "2026-11-01T09:00:00.000Z",
          updated_at: "2026-11-01T09:00:00.000Z",
          label: "One",
        },
      ],
    };
    // What the previous release's `contentFingerprint` gave this page, run
    // on its own code: fixed here, so a wrong reading of the earlier rule
    // can't make up the fingerprint it then recognises.
    const keptByPreviousRelease =
      "7bc7359f83562a78c0b522dece68753cf8e5a3c299a44c4e8832fcd4decd071d";
    expect(earlierContentFingerprints(page)).toEqual([keptByPreviousRelease]);
    expect(contentFingerprint(page)).not.toBe(keptByPreviousRelease);
    // A page with no field group was fingerprinted the same way then.
    expect(earlierContentFingerprints(PAGE)).toEqual([]);
  });

  it("is SHA-256 hex, the same on every dialect", () => {
    expect(contentFingerprint(PAGE)).toMatch(/^[0-9a-f]{64}$/);
  });
});
