/**
 * The read a route performs for the components its page embeds.
 *
 * In its own file because it replaces `cachedFind` to capture the tags and key
 * the read carries, and that substitution is hoisted over the whole module.
 * What is asserted is the shape of the request: how many round trips, under
 * which tags, at which posture, and with which identity — every one of which
 * is invisible in the rendered output and decides whether a cached page is
 * correct.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { coreBlocks } from "./blocks";
import { createBlockResolver } from "./resolver";
import { describe, expect, it, vi } from "vitest";

const cached = vi.fn();

vi.mock("nextly/runtime", async importActual => {
  const actual = await importActual<typeof import("nextly/runtime")>();
  return {
    ...actual,
    cachedFind: vi.fn(
      async (reader: () => Promise<unknown>, options: unknown) => {
        cached(options);
        // The real one runs the reader on a miss, so the double must too, or
        // the assertions below would pass over a read that never happened.
        return await reader();
      }
    ),
    // A scheduled release, so the bound is a number rather than the `false`
    // an empty container answers. Whether the bound is COMPUTED correctly is
    // `nextly`'s to test and is tested there; what belongs here is whether
    // this read asks for one and applies what it gets.
    releaseBoundedRevalidate: vi.fn(async () => 42),
  };
});

const { createBlocksPage } = await import("./next");
const { entryIdTag } = await import("nextly/runtime");

interface FindArgs {
  collection: string;
  where?: Record<string, { equals?: unknown; in?: unknown }>;
  status?: string;
  overrideAccess?: boolean;
  disableErrors?: boolean;
  user?: unknown;
  req?: unknown;
  limit?: number;
}

const page = (componentIds: string[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: componentIds.map((componentId, index) => ({
    id: `i${String(index)}`,
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId },
  })),
});

const definition = (nodes: unknown[] = []): unknown => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes,
});

/**
 * A reader over one page entry and a component store, recording every call.
 *
 * Understands the `in` operator, because that is the operator the batched read
 * uses — a double that only knew `equals` would answer nothing and certify a
 * fetch that silently found no components at all.
 */
function reader(components: Record<string, unknown>, content: BlockDocument) {
  const calls: FindArgs[] = [];
  return {
    calls,
    nextly: {
      find: vi.fn(async (args: FindArgs) => {
        calls.push(args);
        if (args.collection === "components") {
          const wanted = args.where?.id?.in;
          const ids = Array.isArray(wanted) ? (wanted as string[]) : [];
          return {
            items: ids
              .filter(id => Object.hasOwn(components, id))
              .map(id => ({ id, content: components[id] })),
            meta: {},
          };
        }
        return {
          items: [{ id: "p1", slug: "about", content }],
          meta: {},
        };
      }),
      findByID: vi.fn(async () => null),
      media: { findByID: vi.fn(async () => null) },
    } as never,
  };
}

async function renderWith(
  components: Record<string, unknown>,
  content: BlockDocument,
  extra: Record<string, unknown> = {}
) {
  cached.mockClear();
  const r = reader(components, content);
  const route = createBlocksPage({
    collections: ["pages"],
    field: "content",
    nextly: r.nextly,
    ...extra,
  } as Parameters<typeof createBlocksPage>[0]);
  const element = (await route.ContentPage({
    params: { slug: ["about"] },
  })) as ReactElement<{ definitions?: Map<string, BlockDocument> }>;
  return { props: element.props, calls: r.calls };
}

const componentReads = (calls: FindArgs[]) =>
  calls.filter(call => call.collection === "components");

describe("the definitions a route reads for its page", () => {
  it("reads every referenced component in ONE query", async () => {
    const { props, calls } = await renderWith(
      { hero: definition(), footer: definition() },
      page(["hero", "footer"])
    );

    const reads = componentReads(calls);
    expect(reads).toHaveLength(1);
    expect(reads[0]!.where?.id?.in).toEqual(["hero", "footer"]);
    expect([...(props.definitions?.keys() ?? [])]).toEqual(["hero", "footer"]);
  });

  it("tags the read per id and NOT with the collection", async () => {
    // `nextlyTags` always prepends the collection tag, so using it here would
    // make publishing any component rebuild every page that embeds any
    // component — the opposite of what a component store is for.
    await renderWith({ hero: definition() }, page(["hero"]));

    const options = cached.mock.calls[0]![0] as { tags: string[] };
    expect(options.tags).toEqual([entryIdTag("components", "hero")]);
    expect(options.tags).not.toContain("nextly:components");
  });

  it("reads definitions at the posture the route serves", async () => {
    // The SAME scope the entry read uses, not a second opinion: a page serving
    // published content must not inline a draft component.
    const served = await renderWith({ hero: definition() }, page(["hero"]));
    expect(componentReads(served.calls)[0]!.status).toBe("published");

    // A route explicitly serving drafts must inline the draft, and it cannot do
    // that through this batched read at any `status` — the overlay lives on the
    // per-id path. Asserted where that read can be observed, under "a
    // component's pending edits in draft mode" below; what belongs here is that
    // the batched query is not the channel it takes.
    const draft = await renderWith({ hero: definition() }, page(["hero"]), {
      draft: true,
    });
    expect(componentReads(draft.calls)).toEqual([]);
  });

  it("clears BOTH identity channels", async () => {
    // `mergeConfig` spreads the reader's defaults UNDER the call, so an
    // omitted `user` or `req` restores whatever identity the instance was
    // booted with — on a read this route performs for an anonymous visitor,
    // into a page that is then cached.
    const { calls } = await renderWith({ hero: definition() }, page(["hero"]));

    const read = componentReads(calls)[0]!;
    expect(read.overrideAccess).toBe(true);
    expect(read.disableErrors).toBe(true);
    expect("user" in read).toBe(true);
    expect(read.user).toBeUndefined();
    expect("req" in read).toBe(true);
    expect(read.req).toBeUndefined();
  });

  it("hands over a row whose field is unreadable rather than dropping it", async () => {
    // Presence is what separates "nobody published one" from "one is published
    // and cannot be read". Filtering the bad row here would report the first.
    const { props } = await renderWith(
      { hero: "not a document" },
      page(["hero"])
    );

    expect(props.definitions?.has("hero")).toBe(true);
  });

  it("keys the read by cache scope, so two tenants cannot share an entry", async () => {
    // Two deployments pointed at different databases ask for the same ids
    // under the same collection, status and locale. Without the discriminator
    // the first to warm the entry serves ITS definitions to the other's pages.
    await renderWith({ hero: definition() }, page(["hero"]), {
      cacheScope: "tenant-a",
    });
    const a = cached.mock.calls[0]![0] as { keyParts: string[] };

    await renderWith({ hero: definition() }, page(["hero"]), {
      cacheScope: "tenant-b",
    });
    const b = cached.mock.calls[0]![0] as { keyParts: string[] };

    expect(a.keyParts).toContain("tenant-a");
    expect(b.keyParts).toContain("tenant-b");
    expect(a.keyParts).not.toEqual(b.keyParts);
  });

  it("splits a page past the tag cap into queries that stay invalidatable", async () => {
    // Next drops cache tags past 128 and Nextly clamps a query to 500 rows.
    // Both are silent: the first leaves a component uninvalidatable by its own
    // publish, the second returns a subset and reports the rest missing.
    const ids = Array.from({ length: 200 }, (_, i) => `c${String(i)}`);
    const store = Object.fromEntries(ids.map(id => [id, definition()]));

    const { props, calls } = await renderWith(store, page(ids));

    const reads = componentReads(calls);
    expect(reads).toHaveLength(2);
    expect(reads.every(read => (read.where?.id?.in as string[]).length <= 128));
    for (const call of cached.mock.calls) {
      expect((call[0] as { tags: string[] }).tags.length).toBeLessThanOrEqual(
        128
      );
    }
    expect(props.definitions?.size).toBe(200);
  });

  it("drops a blank component id instead of failing the page", async () => {
    // `entryIdTag` refuses a blank segment by throwing, and `componentIdsIn`
    // reports "   " as a reference because it is a nonempty string. Left in,
    // one malformed instance takes the page down before a block boundary
    // exists to contain it.
    const { props } = await renderWith(
      { hero: definition() },
      page(["hero", "   "])
    );

    expect(props.definitions?.has("hero")).toBe(true);
    expect(props.definitions?.has("   ")).toBe(false);
  });

  it("charges a host's own source to the same budget", async () => {
    // A site's source is the one most likely to be database- or network-backed,
    // so exempting it bounds the reader we wrote and leaves unbounded the one
    // the site supplies — the wrong way round, and the reason `mediaResolver`
    // charges a custom `resolveMedia` too.
    const asked: string[][] = [];
    await renderWith({}, page(["hero"]), {
      maxQueries: 0,
      resolveComponents: (ids: readonly string[]) => {
        asked.push([...ids]);
        return Promise.resolve(new Map());
      },
    });

    expect(asked).toEqual([]);
  });

  it("fetches under the caps the renderer will draw under", async () => {
    // `prepareDocumentReadStages` falls back to the style context's limits, so
    // a route that raises `maxNodes` there and not directly would fetch for the
    // first 5,000 nodes while the renderer kept every instance after them.
    const ids = Array.from({ length: 3 }, (_, i) => `c${String(i)}`);
    const store = Object.fromEntries(ids.map(id => [id, definition()]));

    const { calls } = await renderWith(store, page(ids), {
      styleContext: {
        breakpoints: { viewport: [], container: [] },
        limits: { maxDepth: 12, maxNodes: 2, maxBytes: 2_097_152 },
      },
    });

    // Two nodes' worth of instances reached, because that is the cap the
    // renderer is about to read the same document under.
    const read = componentReads(calls)[0]!;
    expect((read.where?.id?.in as string[]).length).toBe(2);
  });

  it("derives metadata from the SAME components the page renders", async () => {
    // The heading a visitor sees comes from a component. Without the
    // definitions, the metadata preparation replaces that instance with a
    // placeholder and derives a title from a document the page does not show —
    // for exactly the pages components exist to build.
    const heading = {
      id: "h",
      type: "core/heading",
      version: 1,
      props: { text: "Composed title", level: 1 },
    };
    const r = reader({ hero: definition([heading]) }, page(["hero"]));
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: r.nextly,
      blocks: createBlockResolver(coreBlocks),
      // `metadata`, not `buildMetadata` — the latter is the route's own hook,
      // which cannot see the document and would bypass the derivation entirely.
      metadata: (
        _entry: unknown,
        _context: unknown,
        derived: { title?: string }
      ) => ({ title: derived.title ?? "NO TITLE" }),
    } as Parameters<typeof createBlocksPage>[0]);

    const meta = await route.generateMetadata({ params: { slug: ["about"] } });

    expect(meta.title).toBe("Composed title");
  });

  it("bounds the read by the next scheduled release", async () => {
    // Without a window the entry is created with `revalidate: false`, so at
    // the release instant the page read refreshes around a nested lookup that
    // stays a cache hit — and the page keeps drawing the pre-release component
    // until some unrelated write busts its id tag.
    await renderWith({ hero: definition() }, page(["hero"]));

    const options = cached.mock.calls[0]![0] as { revalidate?: number | false };
    expect(options.revalidate).toBe(42);
  });

  it("asks for nothing when the page embeds no component", async () => {
    const { calls, props } = await renderWith(
      { hero: definition() },
      {
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [{ id: "a", type: "core/text", version: 1, props: {} }],
      }
    );

    expect(componentReads(calls)).toEqual([]);
    expect(props.definitions).toBeUndefined();
  });
});

/**
 * What a draft-mode route hands its renderer when a component has pending edits.
 *
 * The store double below reproduces the ONE asymmetry this whole suite turns
 * on, and it is a property of the service, not an invention: the working-draft
 * overlay is applied in `collection-query-service.getEntry`, so `findByID` can
 * surface a pending edit and `find` — the list path, which has no equivalent —
 * cannot. A double whose `find` answered drafts would certify a batched read
 * that cannot work against the real reader.
 */
function splitStoreReader(
  published: Record<string, unknown>,
  drafts: Record<string, unknown>,
  content: BlockDocument
) {
  const calls: FindArgs[] = [];
  const byId: { id: string; draft?: boolean }[] = [];
  return {
    calls,
    byId,
    nextly: {
      find: vi.fn(async (args: FindArgs) => {
        calls.push(args);
        if (args.collection === "components") {
          const wanted = args.where?.id?.in;
          const ids = Array.isArray(wanted) ? (wanted as string[]) : [];
          // PUBLISHED only, whatever `status` says. `status: "all"` widens which
          // ROWS match; it does not reach a working draft, which lives in a
          // snapshot the list path never consults.
          return {
            items: ids
              .filter(id => Object.hasOwn(published, id))
              .map(id => ({ id, content: published[id] })),
            meta: {},
          };
        }
        return { items: [{ id: "p1", slug: "about", content }], meta: {} };
      }),
      findByID: vi.fn(
        async (args: { collection: string; id: string; draft?: boolean }) => {
          if (args.collection !== "components") return null;
          byId.push({ id: args.id, draft: args.draft });
          const row =
            args.draft === true && Object.hasOwn(drafts, args.id)
              ? drafts[args.id]
              : published[args.id];
          return row === undefined ? null : { id: args.id, content: row };
        }
      ),
      media: { findByID: vi.fn(async () => null) },
    } as never,
  };
}

const headingNode = (text: string) => ({
  id: "h",
  type: "core/heading",
  version: 1,
  props: { text, level: 1 },
});

describe("a component's pending edits in draft mode", () => {
  it("previews the WORKING DRAFT, not the last published definition", async () => {
    // The defect this row exists for: the editor iframe drew the last published
    // component while the author was editing it, so the preview disagreed with
    // the form beside it.
    const r = splitStoreReader(
      { hero: definition([headingNode("PUBLISHED")]) },
      { hero: definition([headingNode("PENDING EDIT")]) },
      page(["hero"])
    );
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: r.nextly,
      draft: true,
    } as Parameters<typeof createBlocksPage>[0]);

    const element = (await route.ContentPage({
      params: { slug: ["about"] },
    })) as ReactElement<{ definitions?: Map<string, BlockDocument> }>;

    const hero = element.props.definitions?.get("hero");
    expect(hero?.nodes[0]?.props).toMatchObject({ text: "PENDING EDIT" });
  });

  it("draws the pending edit into the page the visitor is shown", async () => {
    // Asserted through the COMPOSED document rather than the definitions map,
    // because the map is the fetch's own output: a read that returned the draft
    // and a composition that dropped it would still satisfy the test above.
    // `derived.title` is produced by composing the page with its definitions.
    const r = splitStoreReader(
      { hero: definition([headingNode("PUBLISHED")]) },
      { hero: definition([headingNode("PENDING EDIT")]) },
      page(["hero"])
    );
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: r.nextly,
      draft: true,
      blocks: createBlockResolver(coreBlocks),
      metadata: (
        _entry: unknown,
        _context: unknown,
        derived: { title?: string }
      ) => ({ title: derived.title ?? "NO TITLE" }),
    } as Parameters<typeof createBlocksPage>[0]);

    const meta = await route.generateMetadata({ params: { slug: ["about"] } });

    expect(meta.title).toBe("PENDING EDIT");
  });

  it("does NOT cache the draft read", async () => {
    // The rule `resolve-content` states for the draft entry read, which this
    // read sits beside: a working draft changes on every save while cache tags
    // are burst by writes to the LIVE row, so a cached draft shows an editor
    // their previous save and calls it a preview. No key fixes that, which is
    // why the answer is not to cache rather than to key more finely.
    cached.mockClear();
    const r = splitStoreReader(
      { hero: definition() },
      { hero: definition() },
      page(["hero"])
    );
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: r.nextly,
      draft: true,
    } as Parameters<typeof createBlocksPage>[0]);

    await route.ContentPage({ params: { slug: ["about"] } });

    expect(r.byId).toHaveLength(1);
    expect(cached).not.toHaveBeenCalled();
  });

  it("keeps the published route on ONE batched query", async () => {
    // The per-id read is the price of seeing a draft and is paid in the editor
    // iframe only. Taken on the published path it would turn one query per page
    // into one per component, on the path that serves every visitor.
    const r = splitStoreReader(
      { hero: definition(), footer: definition() },
      {},
      page(["hero", "footer"])
    );
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: r.nextly,
    } as Parameters<typeof createBlocksPage>[0]);

    await route.ContentPage({ params: { slug: ["about"] } });

    expect(componentReads(r.calls)).toHaveLength(1);
    expect(r.byId).toEqual([]);
  });

  it("lets an EXPLICIT published status beat the draft widening", async () => {
    // The order `resolveDraftOverlay` applies: a route that named `published`
    // is asking for the live document, and overlaying a pending edit on top of
    // it answers a question it did not ask. Without this the `draft: true`
    // half of the gate would decide alone, and a route that had narrowed
    // itself on purpose would quietly serve drafts.
    const r = splitStoreReader(
      { hero: definition([headingNode("PUBLISHED")]) },
      { hero: definition([headingNode("PENDING EDIT")]) },
      page(["hero"])
    );
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: r.nextly,
      draft: true,
      status: "published",
    } as Parameters<typeof createBlocksPage>[0]);

    const element = (await route.ContentPage({
      params: { slug: ["about"] },
    })) as ReactElement<{ definitions?: Map<string, BlockDocument> }>;

    expect(r.byId).toEqual([]);
    expect(componentReads(r.calls)[0]!.status).toBe("published");
    expect(
      element.props.definitions?.get("hero")?.nodes[0]?.props
    ).toMatchObject({ text: "PUBLISHED" });
  });

  it("asks for the draft explicitly rather than relying on a widened status", async () => {
    // `status: "all"` widens which rows match; it does not reach the working
    // draft. Without the opt-in the per-id read would return the published row
    // and the page would be exactly as wrong, through a more expensive route.
    const r = splitStoreReader(
      { hero: definition() },
      { hero: definition() },
      page(["hero"])
    );
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: r.nextly,
      draft: true,
    } as Parameters<typeof createBlocksPage>[0]);

    await route.ContentPage({ params: { slug: ["about"] } });

    expect(r.byId).toEqual([{ id: "hero", draft: true }]);
  });
});
