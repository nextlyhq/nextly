/**
 * A Single route's posture is a property of the READ, and its error handling
 * decides whether a fault becomes a permanent missing page.
 *
 * Both halves are asserted through `generateMetadata` rather than through the
 * page component, deliberately. The page reaches `notFound()`, which only
 * exists inside a Next runtime, so a unit test exercising it would be measuring
 * the absence of `next/navigation` rather than the classification under test —
 * and a miss and a transient failure would become the same thrown error.
 * `generateMetadata` distinguishes them: it answers `{}` for a document that is
 * not there, and propagates anything it could not classify.
 */
import { describe, expect, it } from "vitest";

import type { FindSingleArgs } from "../../../direct-api/types/singles";
import { NextlyError } from "../../../errors/nextly-error";
import {
  createPublicSingleRoute,
  createSingleRoute,
  type NextlySingleReader,
  type SingleDocument,
} from "../single-route";

type Answer = SingleDocument | (() => never);

/** A reader that records how it was asked, and answers as configured. */
function stubReader(answer: Answer): {
  reader: NextlySingleReader;
  calls: FindSingleArgs[];
} {
  const calls: FindSingleArgs[] = [];
  const reader = {
    findSingle: async (args: FindSingleArgs) => {
      calls.push(args);
      if (typeof answer === "function") answer();
      return answer as never;
    },
  } as unknown as NextlySingleReader;
  return { reader, calls };
}

const HOME: SingleDocument = { title: "Home", layout: { nodes: [] } };

describe("single route posture", () => {
  it("reads as the visitor would when access is enforced", async () => {
    const { reader, calls } = stubReader(HOME);
    const { generateMetadata } = createSingleRoute({
      slug: "homepage",
      nextly: reader,
      render: () => "rendered",
      buildMetadata: document => ({ title: String(document.title) }),
    });

    await generateMetadata();

    expect(calls).toHaveLength(1);
    expect(calls[0].overrideAccess).toBe(false);
  });

  it("reads trusted when the site has declared the single public", async () => {
    const { reader, calls } = stubReader(HOME);
    const { generateMetadata } = createPublicSingleRoute({
      slug: "homepage",
      nextly: reader,
      render: () => "rendered",
      buildMetadata: document => ({ title: String(document.title) }),
    });

    await generateMetadata();

    expect(calls).toHaveLength(1);
    expect(calls[0].overrideAccess).toBe(true);
  });

  it("forwards the configured locale to the read", async () => {
    const { reader, calls } = stubReader(HOME);
    const { generateMetadata } = createSingleRoute({
      slug: "homepage",
      locale: "es",
      nextly: reader,
      render: () => "rendered",
      buildMetadata: () => ({}),
    });

    await generateMetadata();

    expect(calls[0].locale).toBe("es");
  });

  it("reports the configured locale to the caller's callbacks", async () => {
    const { reader } = stubReader(HOME);
    const seen: unknown[] = [];
    const { generateMetadata } = createSingleRoute({
      slug: "homepage",
      locale: "es",
      nextly: reader,
      render: () => "rendered",
      buildMetadata: (_document, context) => {
        seen.push(context);
        return {};
      },
    });

    await generateMetadata();

    expect(seen).toEqual([{ slug: "homepage", locale: "es" }]);
  });

  it("hands the resolved document to buildMetadata", async () => {
    const { reader } = stubReader(HOME);
    const { generateMetadata } = createSingleRoute({
      slug: "homepage",
      nextly: reader,
      render: () => "rendered",
      buildMetadata: document => ({ title: String(document.title) }),
    });

    await expect(generateMetadata()).resolves.toEqual({ title: "Home" });
  });
});

describe("single route failure classification", () => {
  it("treats a missing single as a page that is not there", async () => {
    const { reader } = stubReader(() => {
      throw NextlyError.notFound();
    });
    const { generateMetadata } = createSingleRoute({
      slug: "homepage",
      nextly: reader,
      render: () => "rendered",
      buildMetadata: () => ({ title: "should not be reached" }),
    });

    await expect(generateMetadata()).resolves.toEqual({});
  });

  it("treats a denied single as absent rather than as forbidden", async () => {
    // A single the visitor may not see must be indistinguishable from one that
    // does not exist, or the route answers the question the rule refused.
    const { reader } = stubReader(() => {
      throw NextlyError.forbidden();
    });
    const { generateMetadata } = createSingleRoute({
      slug: "homepage",
      nextly: reader,
      render: () => "rendered",
      buildMetadata: () => ({ title: "should not be reached" }),
    });

    await expect(generateMetadata()).resolves.toEqual({});
  });

  it("RETHROWS a read that broke, so a blip cannot become a missing page", async () => {
    const failure = NextlyError.internal({
      logContext: { reason: "connection reset" },
    });
    const { reader } = stubReader(() => {
      throw failure;
    });
    const { generateMetadata } = createSingleRoute({
      slug: "homepage",
      nextly: reader,
      render: () => "rendered",
      buildMetadata: () => ({}),
    });

    await expect(generateMetadata()).rejects.toBe(failure);
  });

  it("rethrows a non-Nextly failure untouched", async () => {
    const failure = new TypeError("reader is not a function");
    const { reader } = stubReader(() => {
      throw failure;
    });
    const { generateMetadata } = createSingleRoute({
      slug: "homepage",
      nextly: reader,
      render: () => "rendered",
      buildMetadata: () => ({}),
    });

    await expect(generateMetadata()).rejects.toBe(failure);
  });
});

describe("createPublicSingleRoute construction", () => {
  it("refuses a user, because a trusted read never consults access rules", () => {
    const { reader } = stubReader(HOME);

    expect(() =>
      createPublicSingleRoute({
        slug: "homepage",
        nextly: reader,
        user: { id: "u1" } as never,
        render: () => "rendered",
      })
    ).toThrow(/does not evaluate access rules/);
  });

  it("accepts the same config without a user", () => {
    const { reader } = stubReader(HOME);

    expect(() =>
      createPublicSingleRoute({
        slug: "homepage",
        nextly: reader,
        render: () => "rendered",
      })
    ).not.toThrow();
  });
});

/**
 * A draft grant authorizes ONE document and says nothing about what that
 * document points at.
 *
 * The read it triggers is trusted, so without a bound the bypass spreads to
 * every collection the Single populates — and a caller who may preview this
 * document receives related records they have no permission to read at all.
 * The bound is the same option, with the same meaning, that a content route
 * carries.
 */
describe("how far a Single route's trust reaches", () => {
  /** The `trusted` predicate the route handed the reader, if any. */
  async function boundFrom(
    config: Record<string, unknown>
  ): Promise<((collection: string) => boolean) | undefined> {
    const { reader, calls } = stubReader(HOME);
    const { generateMetadata } = createSingleRoute({
      slug: "homepage",
      nextly: reader,
      render: () => "rendered",
      buildMetadata: document => ({ title: String(document.title) }),
      ...config,
    });

    await generateMetadata();

    expect(calls).toHaveLength(1);
    return (calls[0] as { trusted?: (collection: string) => boolean }).trusted;
  }

  // The positive control. Without it the assertions below cannot tell "bounded
  // to nothing" from "no bound was passed at all", which are opposite outcomes
  // reported by the same `false`.
  it("passes a bound the reader can actually consult", async () => {
    expect(await boundFrom({ draft: true })).toBeTypeOf("function");
  });

  it("trusts nothing by default, which is what a draft grant authorizes", async () => {
    const trusted = await boundFrom({ draft: true });

    expect(trusted?.("posts")).toBe(false);
  });

  it("trusts exactly what the route named, and nothing beside it", async () => {
    const trusted = await boundFrom({
      draft: true,
      trustedCollections: ["posts"],
    });

    expect(trusted?.("posts")).toBe(true);
    expect(trusted?.("authors")).toBe(false);
  });

  // Passed on an enforced read too. It decides nothing there — the reader
  // evaluates `overrideAccess && trusted(target)` — and travelling with every
  // read is what makes it impossible to omit on the one path that matters.
  it("travels with an ordinary read as well", async () => {
    expect(await boundFrom({})).toBeTypeOf("function");
  });
});
