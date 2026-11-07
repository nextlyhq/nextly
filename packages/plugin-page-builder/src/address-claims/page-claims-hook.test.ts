/**
 * The save hook's part while the start-up pass runs: it takes the page's
 * lock so the two take turns, and it finds the pages in a paginated list's
 * way by the addresses they are served at, across every batch of pages.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimAddress,
  lockHolder,
  reconcileHolder,
  type Claims,
  type Tx,
} from "./claim-store";
import {
  registerPageAddressClaims,
  type PageClaimsDeps,
} from "./page-claims-hook";

vi.mock("./claim-store", () => ({
  claimAddress: vi.fn(async () => undefined),
  lockHolder: vi.fn(async () => undefined),
  reconcileHolder: vi.fn(async () => true),
  releaseClaims: vi.fn(async () => undefined),
  sharePending: vi.fn(),
}));

const TX = {} as Tx;

/** A page document holding one list split into pages. */
const PAGINATED = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "list",
      type: "core/collection-loop",
      version: 1,
      props: { collection: "pages", limit: 10, paginate: true },
      slots: { children: [], empty: [] },
    },
  ],
};

/** The hook as registered with `deps`, ready to be handed a write. */
function hookWith(
  deps: Partial<PageClaimsDeps>
): (write: Record<string, unknown>) => Promise<void> {
  let handler: ((write: never) => Promise<void>) | undefined;
  registerPageAddressClaims(
    { onInTransaction: (_slug, registered) => void (handler = registered) },
    {
      pages: "pages",
      claims: {} as Claims,
      locales: () => ["en"],
      nextly: async () => ({ findByID: async () => null }),
      collection: async () => null,
      backfillDone: () => false,
      publishedPages: async function* () {
        yield* [];
      },
      ...deps,
    }
  );
  return write =>
    (handler ?? (async () => undefined))({
      operation: "update",
      transaction: TX,
      ...write,
    } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registerPageAddressClaims while the start-up pass runs", () => {
  it("claims a page in a list's way by the address it is served at, in a later batch", async () => {
    const save = hookWith({
      pathTemplate: "/{slug}/{title}",
      async *publishedPages() {
        // Its slug starts with the list's, but it is served at
        // /news/page/2/old, outside the list's later pages.
        yield [
          { id: "x", slug: "news/page/2", title: "old", status: "published" },
        ];
        // Its slug does not, but it is served at /news/latest/page/2.
        yield [
          {
            id: "b",
            slug: "news/latest/page",
            title: "2",
            status: "published",
          },
        ];
      },
    });
    await save({
      id: "list-page",
      data: {
        slug: "news",
        title: "latest",
        status: "published",
        content: PAGINATED,
      },
    });
    expect(vi.mocked(claimAddress).mock.calls.map(call => call[2])).toEqual([
      expect.objectContaining({
        address: { locale: "en", segments: ["news", "latest", "page", "2"] },
        holder: { collection: "pages", id: "b" },
      }),
    ]);
  });

  it("takes the page's lock before it reconciles, and none once the pass is done", async () => {
    const data = { slug: "about", status: "published", content: PAGINATED };
    await hookWith({})({ id: "p", data });
    expect(vi.mocked(lockHolder).mock.calls[0]?.[2]).toEqual({
      collection: "pages",
      id: "p",
    });
    expect(vi.mocked(lockHolder).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(reconcileHolder).mock.invocationCallOrder[0] ?? 0
    );

    vi.clearAllMocks();
    const walked = vi.fn();
    await hookWith({
      backfillDone: () => true,
      async *publishedPages() {
        walked();
        yield* [];
      },
    })({ id: "p", data });
    expect(lockHolder).not.toHaveBeenCalled();
    expect(walked).not.toHaveBeenCalled();
    expect(reconcileHolder).toHaveBeenCalledTimes(1);
  });
});
