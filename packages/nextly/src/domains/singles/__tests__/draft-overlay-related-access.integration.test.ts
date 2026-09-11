/**
 * A Single's pending draft is read under the same related-row access as its
 * live document.
 *
 * The working-draft overlay REPLACES the assembled document and re-expands the
 * snapshot's relationships, so it is a second read of every target row. It
 * used to build its own expansion context, with neither enforcement flag set,
 * and an incomplete context is a valid one describing a different caller: the
 * overlay read every target fully trusted. A relationship in a pending draft
 * exposed rows from a target whose rule refuses the caller, while the live
 * relationship — and a direct read of the target — withheld them.
 *
 * So the live read is asserted first, as the control the draft read has to
 * agree with, and both are made by an editor the target's rule refuses: the
 * caller has to be able to EDIT the Single for the overlay to apply at all,
 * which is exactly the caller the gap affected.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineSingle,
  relationship,
  text,
} from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "homepage";
const EDITOR = { id: "editor" };

/**
 * A published Single that holds drafts, pointing at a collection only
 * `permitted` may read. The editor may update the Single — which is what
 * makes the draft overlay apply to them — but is not `permitted`.
 */
async function boot(): Promise<{
  singles: SingleEntryService;
  pageId: string;
}> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "pages",
        access: { read: ({ user }) => user?.id === "permitted" },
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: SLUG,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "headline" }),
          relationship({ name: "featured", relationTo: "pages" }),
        ],
      }),
    ],
  });

  const handler = current.getService("collectionsHandler");
  const page = await handler.createEntry(
    { collectionName: "pages", overrideAccess: true },
    { title: "Restricted page" }
  );
  return {
    singles: current.getService("singleEntryService"),
    pageId: (page.data as { id: string }).id,
  };
}

describe("single draft overlay — related-row collection access (integration)", () => {
  it("withholds a refused target from the draft read as it does from the live read", async () => {
    const { singles, pageId } = await boot();

    // Published with the reference in place, then edited: the published row
    // keeps the reference and the edit is held as a pending draft that also
    // carries it.
    const published = await singles.update(
      SLUG,
      { headline: "Live", featured: pageId, status: "published" },
      { overrideAccess: true }
    );
    expect(published.success).toBe(true);
    const held = await singles.update(
      SLUG,
      { headline: "Edited" },
      { overrideAccess: true }
    );
    expect(held.success).toBe(true);

    // The control: the live read withholds the target from this editor.
    const live = await singles.get(SLUG, {
      user: EDITOR,
      overrideAccess: false,
      depth: 1,
    });
    expect(live.success).toBe(true);
    expect(
      JSON.stringify((live.data as Record<string, unknown>).featured)
    ).not.toContain("Restricted page");

    // The draft read must agree with it. The overlay is proven to have
    // applied — the draft's own headline is what comes back — so a withheld
    // target here is withheld BY the overlay's expansion, not by the overlay
    // never having run.
    const draft = await singles.get(SLUG, {
      user: EDITOR,
      overrideAccess: false,
      includeWorkingDraft: true,
      status: "all",
      depth: 1,
    });
    expect(draft.success).toBe(true);
    const data = draft.data as Record<string, unknown>;
    expect(data.headline).toBe("Edited");
    expect(data._isWorkingDraft).toBe(true);
    expect(JSON.stringify(data.featured)).not.toContain("Restricted page");
  });

  it("still populates the target for a reader the rule admits", async () => {
    // The mirror: withholding everything would pass the case above.
    const { singles, pageId } = await boot();
    await singles.update(
      SLUG,
      { headline: "Live", featured: pageId, status: "published" },
      { overrideAccess: true }
    );
    await singles.update(
      SLUG,
      { headline: "Edited" },
      { overrideAccess: true }
    );

    const draft = await singles.get(SLUG, {
      user: { id: "permitted" },
      overrideAccess: false,
      includeWorkingDraft: true,
      status: "all",
      depth: 1,
    });
    expect(draft.success).toBe(true);
    const data = draft.data as Record<string, unknown>;
    expect(data.headline).toBe("Edited");
    expect(JSON.stringify(data.featured)).toContain("Restricted page");
  });
});
