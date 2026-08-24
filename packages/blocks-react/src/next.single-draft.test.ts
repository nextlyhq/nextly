/**
 * A Single rendered as a blocks page can honour a preview token.
 *
 * The composition is what these cover, not the gate: `createSinglePage` builds a
 * `SingleRouteConfig` from a blocks config, and a `draft` hook that is dropped
 * on the way through leaves a route that verifies a preview link, redirects to
 * it, and then serves the PUBLISHED document from a page that looks entirely
 * correct — the failure the whole draft-preview path exists to remove, and the
 * one that is invisible from either end.
 *
 * Asserted through the arguments the reader receives, because that is where a
 * dropped hook becomes observable: the read either asks for the working draft
 * or it does not.
 */
import { describe, expect, it, vi } from "vitest";

import { createPublicSinglePage, createSinglePage } from "./next";
import { coreBlocks } from "./blocks";
import { createBlockResolver } from "./resolver";

/** A reader recording how the route asked for the Single. */
function singleReader() {
  const calls: Record<string, unknown>[] = [];
  const reader = {
    findSingle: vi.fn(async (args: Record<string, unknown>) => {
      calls.push(args);
      return { title: "Home", content: null };
    }),
    find: vi.fn(async () => ({ docs: [], totalDocs: 0 })),
    findByID: vi.fn(async () => null),
  };
  return { reader, calls };
}

function pageWith(draft: boolean | (() => boolean) | undefined) {
  const { reader, calls } = singleReader();
  const route = createSinglePage({
    slug: "homepage",
    field: "content",
    blocks: createBlockResolver(coreBlocks),
    nextly: reader as never,
    // Present because `generateMetadata` short-circuits without one, returning
    // `{}` before it resolves anything — the reader would never be asked, and
    // every assertion below would be measuring a route that never ran.
    metadata: () => ({ title: "Home" }),
    ...(draft === undefined ? {} : { draft }),
  });
  return { route, calls };
}

describe("a Single blocks page and its draft hook", () => {
  // The positive control. Without it the negative below cannot distinguish
  // "the hook was threaded and answered no" from "the hook never arrived".
  it("asks for the working draft when the hook grants it", async () => {
    const { route, calls } = pageWith(true);

    await route.generateMetadata();

    expect(calls).toHaveLength(1);
    expect(calls[0].draft).toBe(true);
    expect(calls[0].status).toBe("all");
    // Trusted follows from the grant, not from the posture: the overlay is
    // gated on edit capability while this route resolves anonymously, so an
    // enforced draft read would return published values and report success.
    expect(calls[0].overrideAccess).toBe(true);
  });

  it("does not when the hook refuses", async () => {
    const { route, calls } = pageWith(() => false);

    await route.generateMetadata();

    expect(calls).toHaveLength(1);
    expect(calls[0].draft).toBeUndefined();
    expect(calls[0].overrideAccess).toBe(false);
  });

  it("does not when no hook is declared, which is most routes", async () => {
    const { route, calls } = pageWith(undefined);

    await route.generateMetadata();

    expect(calls).toHaveLength(1);
    expect(calls[0].draft).toBeUndefined();
  });

  // The refusal lives in `createPublicSingleRoute`; this asserts the hook
  // reaches it rather than being dropped on the way, which would leave the
  // public factory silently accepting a draft it cannot serve.
  it("refuses the hook on the public factory, which is cached", () => {
    expect(() =>
      createPublicSinglePage({
        slug: "homepage",
        field: "content",
        blocks: createBlockResolver(coreBlocks),
        nextly: singleReader().reader as never,
        draft: true,
      })
    ).toThrow(/cannot serve drafts/i);
  });
});
