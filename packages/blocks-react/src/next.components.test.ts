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
    // The SAME scope the entry read uses, not a second opinion. A page serving
    // published content must not inline a draft component, and a route
    // explicitly serving drafts must.
    const served = await renderWith({ hero: definition() }, page(["hero"]));
    expect(componentReads(served.calls)[0]!.status).toBe("published");

    const draft = await renderWith({ hero: definition() }, page(["hero"]), {
      draft: true,
    });
    expect(componentReads(draft.calls)[0]!.status).toBe("all");
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
