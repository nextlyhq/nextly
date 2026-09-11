/**
 * A `single:` widget query earns exactly what a read of the single earns.
 *
 * `single-sources.test.ts` mocks the Direct API, so it can assert the
 * arguments the executor builds and never what the read path does with them.
 * This boots a real Nextly on in-memory SQLite: the single's code-defined read
 * rule is real, the document is real, and the refusal is observed rather than
 * restated. The derived status card is checked the same way, through the
 * decision the layout endpoint offers cards with.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { readAccessCaller } from "../../../api/authenticated-read";
import { allWidgets } from "../canonical";
import { refreshCollectionWidgets } from "../collection-widgets";
import { executeWidgetQuery } from "../execute";
import { validateWidgetQuery } from "../query";
import { readableEntities } from "../../../auth/entity-read-access";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SETTINGS = "site-settings";
const PRIVATE = "private-notes";

/** A real editor, never an admin, never trusted. */
const editor: ReadCaller = {
  user: { id: "editor-1", roles: ["editor"] },
};

/**
 * Two singles: one any authenticated reader may read, one whose code rule
 * refuses everyone. Both carry the publish lifecycle, so the derived card has
 * a state to name. The readable one is written so the read has a document to
 * answer with rather than materializing one on the way.
 */
async function boot(): Promise<TestNextly> {
  const t = await createTestNextly({
    singles: [
      defineSingle({
        slug: SETTINGS,
        status: true,
        access: { read: () => true, update: () => true },
        fields: [text({ name: "siteName" }), text({ name: "tagline" })],
      }),
      defineSingle({
        slug: PRIVATE,
        access: { read: () => false, update: () => true },
        fields: [text({ name: "note" })],
      }),
    ],
  });
  await t.nextly.updateSingle({
    slug: SETTINGS,
    data: { siteName: "Acme", tagline: "Hello" },
    overrideAccess: true,
  });
  // What the layout and query endpoints do before resolving anything: publish
  // the sources and the cards derived from them from the live registries.
  await refreshCollectionWidgets();
  return t;
}

describe("a single: query against a real instance", () => {
  it("answers the one document, projected to the selection, to a reader the rule admits", async () => {
    current = await boot();

    const result = await executeWidgetQuery(
      validateWidgetQuery({
        source: `single:${SETTINGS}`,
        op: "list",
        select: ["siteName", "status"],
        status: "all",
      }),
      editor
    );

    expect(result.op).toBe("list");
    if (result.op !== "list") return;
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({ siteName: "Acme", status: "draft" });
    // `tagline` was read -- the document is whole on the way in -- and is not
    // in the answer: the projection is real, not a rename of the document.
    expect(result.items[0]).not.toHaveProperty("tagline");
    expect(result.fields?.map(field => field.name)).toEqual([
      "siteName",
      "status",
    ]);
  });

  it("answers an empty list for a draft-only single asked for its published state", async () => {
    // The read's own refusal, through the real service and the real
    // converter: the document exists as a draft, the published view holds
    // nothing, and the card says so as an empty list rather than as a
    // failure -- while a refusal raised for anything else would fail it.
    current = await boot();

    const result = await executeWidgetQuery(
      validateWidgetQuery({
        source: `single:${SETTINGS}`,
        op: "list",
        select: ["siteName"],
        status: "published",
      }),
      editor
    );

    expect(result.op).toBe("list");
    if (result.op !== "list") return;
    expect(result.items).toEqual([]);
  });

  it("refuses a reader the single's code rule refuses", async () => {
    // The security property, observed rather than restated: the read path
    // evaluates the rule, and the executor adds nothing that could get past it.
    current = await boot();

    await expect(
      executeWidgetQuery(
        validateWidgetQuery({
          source: `single:${PRIVATE}`,
          op: "list",
          select: ["note"],
        }),
        editor
      )
    ).rejects.toThrow();
  });

  it("derives a status card per single, offered only for the singles the reader may read", async () => {
    // The card exists for both -- derivation is about the install -- and the
    // reader gate withholds the one over the refused single by the same
    // entity read the query would have been refused on.
    current = await boot();

    const cards = allWidgets().filter(widget => widget.generated === true);
    const ids = cards.map(widget => widget.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        `single/${SETTINGS}-status`,
        `single/${PRIVATE}-status`,
      ])
    );
    const subjects = new Map(
      cards.map(widget => [widget.id, widget.collection])
    );
    expect(subjects.get(`single/${SETTINGS}-status`)).toBe(SETTINGS);
    expect(subjects.get(`single/${PRIVATE}-status`)).toBe(PRIVATE);

    const readable = await readableEntities(
      [SETTINGS, PRIVATE],
      readAccessCaller(editor)
    );
    expect(readable.has(SETTINGS)).toBe(true);
    expect(readable.has(PRIVATE)).toBe(false);
  });
});
