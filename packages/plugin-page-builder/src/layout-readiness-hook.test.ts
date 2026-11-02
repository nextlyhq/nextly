/**
 * A page published naming an unpublished Layout is told so, after the write;
 * nothing else is.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const recorded: unknown[] = [];

vi.mock("nextly", async importOriginal => {
  const actual = await importOriginal<typeof import("nextly")>();
  return {
    ...actual,
    recordAdvisoryNotice: (notice: unknown) => recorded.push(notice),
  };
});

const {
  registerLayoutReadinessNotice,
  LAYOUT_NOT_PUBLISHED_CODE,
  LAYOUT_NOT_PUBLISHED_MESSAGE,
  LAYOUT_NOT_PUBLISHED_NO_DEFAULT_MESSAGE,
} = await import("./layout-readiness-hook");

type Handler = (context: unknown) => unknown;

/** The hook as registered, run against one write of `data`. */
async function publish(
  data: Record<string, unknown>,
  published: readonly string[],
  defaultLayout: string | null = "main"
): Promise<void> {
  const handlers: { phase: string; collection: string; run: Handler }[] = [];
  registerLayoutReadinessNotice({
    ctx: {
      hooks: {
        on: (phase, collection, run) =>
          handlers.push({ phase, collection, run }),
      },
      services: {
        collections: { getCollection: async () => ({ status: true }) },
      },
    },
    pages: "pages",
    layouts: "layouts",
    settings: "page-builder-settings",
  });
  expect(handlers.map(h => [h.phase, h.collection])).toEqual([
    ["afterCreate", "pages"],
    ["afterUpdate", "pages"],
  ]);
  const nextly = {
    find: async ({ where }: { where: { id: { in: string[] } } }) => ({
      items: where.id.in
        .filter(id => published.includes(id))
        .map(id => ({ id })),
    }),
    findSingle: async () => ({ defaultLayout }),
  };
  await handlers[1]!.run({
    collection: "pages",
    data: { id: "p1", ...data },
    req: { nextly },
  });
}

beforeEach(() => {
  recorded.length = 0;
});

describe("the advisory for a page naming an unpublished Layout", () => {
  it("tells the author when the page is published naming one", async () => {
    await publish({ status: "published", layout: "unfinished" }, ["main"]);
    expect(recorded).toEqual([
      {
        phase: "afterUpdate",
        collection: "pages",
        code: LAYOUT_NOT_PUBLISHED_CODE,
        message: LAYOUT_NOT_PUBLISHED_MESSAGE,
        entryId: "p1",
      },
    ]);
  });

  it("says no header or footer shows when the site has no usable default", async () => {
    // No default set, then a default that is not published itself.
    await publish({ status: "published", layout: "unfinished" }, [], null);
    await publish({ status: "published", layout: "unfinished" }, [], "draft");
    expect(recorded).toHaveLength(2);
    for (const notice of recorded) {
      expect(notice).toMatchObject({
        code: LAYOUT_NOT_PUBLISHED_CODE,
        message: LAYOUT_NOT_PUBLISHED_NO_DEFAULT_MESSAGE,
      });
    }
    expect(LAYOUT_NOT_PUBLISHED_NO_DEFAULT_MESSAGE).toBe(
      "This page names a Layout that is not published, so it is shown with no header or footer until that Layout is published."
    );
  });

  it("says nothing for a published Layout, the default, a draft page, or no header or footer", async () => {
    await publish({ status: "published", layout: "main" }, ["main"]);
    await publish({ status: "published", layout: null }, ["main"]);
    await publish({ status: "draft", layout: "unfinished" }, ["main"]);
    await publish(
      { status: "published", layout: "unfinished", noHeaderFooter: true },
      ["main"]
    );
    expect(recorded).toEqual([]);
  });
});
