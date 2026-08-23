/**
 * The join between a preview token and an ORDINARY content route.
 *
 * Every other draft test in this directory hands the route a decision function
 * written by hand, which proves the route consults its `draft` hook and proves
 * nothing about the hook a real site would pass. `previewDraftGate` is what a
 * real site passes, and until it is exercised through a route the two can agree
 * in a doc comment and disagree in fact — the gate reading one cookie name, the
 * route comparing a different entry, a token shape neither validates.
 *
 * The route here is deliberately NOT a blocks page. The page-builder factory
 * inherits `draft` by extending this config, so it is covered transitively; a
 * site rendering its own content with `createContentRoute` is the case nothing
 * else reaches.
 */
import { afterEach, describe, expect, it } from "vitest";

import { signPreviewToken } from "../../../auth/preview/preview-token";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { PREVIEW_SCOPE_COOKIE } from "../../preview/preview-route";
import { previewDraftGate } from "../../preview/preview-draft-gate";
import { createContentRoute } from "../content-route";
import type { ContentEntry } from "../resolve-content";

const SECRET = "content-route-preview-gate-secret-32chars!!";
const GENERATION = 1;

const pages = () =>
  defineCollection({
    slug: "pages",
    status: true,
    versions: { drafts: true },
    fields: [text({ name: "slug" }), text({ name: "title" })],
  });

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A cookie jar holding one preview token, or nothing at all. */
function cookies(token?: string) {
  return () => ({
    get: (name: string) =>
      name === PREVIEW_SCOPE_COOKIE && token !== undefined
        ? { value: encodeURIComponent(token) }
        : undefined,
  });
}

function route(nextly: TestNextly["nextly"], token?: string) {
  return createContentRoute({
    collections: ["pages"],
    nextly,
    render: (entry: ContentEntry) => entry,
    draft: previewDraftGate({
      secret: SECRET,
      generation: GENERATION,
      cookies: cookies(token),
    }),
  });
}

describe("createContentRoute driven by previewDraftGate", () => {
  it("serves a never-published entry to the visitor whose token names it", async () => {
    current = await createTestNextly({ collections: [pages()] });
    const created = await current.nextly.create({
      collection: "pages",
      data: { slug: "unreleased", title: "Unreleased", status: "draft" },
    });

    const { token } = await signPreviewToken(
      { collection: "pages", entryId: String(created.item.id) },
      SECRET,
      { generation: GENERATION }
    );

    const page = (await route(current.nextly, token).ContentPage({
      params: { slug: ["unreleased"] },
    })) as ContentEntry;

    expect(page.title).toBe("Unreleased");
  });

  // The control for the assertion above. Without it, a resolve that returned a
  // document for reasons unrelated to the token — a lifecycle default, a
  // collection that never enforced status — would read as the gate working.
  it("404s that same entry for a visitor carrying no token", async () => {
    current = await createTestNextly({ collections: [pages()] });
    await current.nextly.create({
      collection: "pages",
      data: { slug: "unreleased", title: "Unreleased", status: "draft" },
    });

    await expect(
      route(current.nextly).ContentPage({ params: { slug: ["unreleased"] } })
    ).rejects.toThrow();
  });

  // One link is a key to ONE document. A token minted for entry A must not open
  // entry B, even though both are unpublished rows of the same collection that
  // the same gate would answer `true` for.
  it("refuses a different unpublished entry in the same collection", async () => {
    current = await createTestNextly({ collections: [pages()] });
    const a = await current.nextly.create({
      collection: "pages",
      data: { slug: "entry-a", title: "A", status: "draft" },
    });
    await current.nextly.create({
      collection: "pages",
      data: { slug: "entry-b", title: "B", status: "draft" },
    });

    const { token } = await signPreviewToken(
      { collection: "pages", entryId: String(a.item.id) },
      SECRET,
      { generation: GENERATION }
    );

    await expect(
      route(current.nextly, token).ContentPage({
        params: { slug: ["entry-b"] },
      })
    ).rejects.toThrow();
  });
});
