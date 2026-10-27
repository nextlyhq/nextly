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

import { userWhoMay } from "../../../__tests__/fixtures/permission-holders";
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
import { CONTENT_SOURCE_ID } from "../system-source-ids";
import { widgetAudience } from "../visibility";

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
  // A code rule only narrows the permission, so the editor holds read on both
  // singles and each single's read rule decides.
  await userWhoMay(t, editor.user.id, "read", [SETTINGS, PRIVATE]);
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
    // The read answers the refused reader as if the Single were missing; the
    // card fails on that answer rather than drawing it as an empty list, and
    // the failure is the gate's own refusal, its reason kept for the log.
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
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      logContext: {
        reason: expect.stringContaining(
          `the caller may not read single "${PRIVATE}"`
        ),
      },
    });
  });

  it("derives no card per single, whose Singles the Content card lists, and keeps their sources", async () => {
    // 🔴 A per-Single card was generated for every Single. Content lists them
    // now, and a saved per-Single card converts into it, so none is derived:
    // not on the install, and not in what the workspace payload ships. The
    // sources stay, since Content and queries naming a Single read them.
    current = await boot();

    const generated = allWidgets()
      .filter(widget => widget.generated === true)
      .map(widget => widget.id);
    expect(generated.filter(id => id.startsWith("single/"))).toEqual([]);

    const audience = await widgetAudience(readAccessCaller(editor));
    expect(
      audience.generated.filter(widget => widget.id.startsWith("single/"))
    ).toEqual([]);

    // Where a Single shows now: the Content card's source lists the one this
    // reader may read, as a Single, and leaves out the one they may not.
    const content = await executeWidgetQuery(
      validateWidgetQuery({ source: CONTENT_SOURCE_ID, op: "list" }),
      editor
    );
    const singles =
      content.op === "list"
        ? content.items
            .filter(row => row.kind === "single")
            .map(row => row.slug)
        : [];
    expect(singles).toContain(SETTINGS);
    expect(singles).not.toContain(PRIVATE);

    // The control: the readable Single's own source still answers its reader.
    const answer = await executeWidgetQuery(
      validateWidgetQuery({ source: `single:${SETTINGS}`, op: "list" }),
      editor
    );
    expect(answer.op).toBe("list");
  });
});
