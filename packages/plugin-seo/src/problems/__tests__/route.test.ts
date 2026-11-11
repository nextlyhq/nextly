/**
 * The list's routes answer only a signed-in person who may read one of the
 * types SEO is added to, with the pages of the types they may read, and ask
 * that before a full check runs.
 */
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ready = vi.hoisted(() => ({ record: true }));

vi.mock("../../address-record/catch-up", () => ({
  addressRecordReady: () => ready.record,
  retryFailedCatchUp: () => undefined,
}));

const calls = vi.hoisted(() => ({
  checked: 0,
  readable: [] as string[],
  reads: [] as string[],
  types: [] as string[],
  counted: 0,
}));

vi.mock("../check", () => ({
  checkSite: async () => {
    calls.checked += 1;
  },
  pageRefKey: (page: { type: string; id: string }) => `${page.type}:${page.id}`,
  problemList: async (
    _ctx: unknown,
    _checks: unknown,
    reader: {
      pages: (
        pages: { type: string; id: string }[]
      ) => Promise<ReadonlySet<string>>;
      readsType: (type: string) => boolean;
      count: (type: string) => Promise<number>;
    }
  ) => {
    calls.types = ["posts", "pages"].filter(type => reader.readsType(type));
    calls.counted = await reader.count("posts");
    const answer = await reader.pages([
      { type: "posts", id: "1" },
      { type: "posts", id: "2" },
      { type: "pages", id: "3" },
    ]);
    calls.readable = [...answer].sort();
    return { problems: [], pagesChecked: 0, outOfDate: false, due: true };
  },
}));

import { problemRoutes } from "../route";

const CHECKS = {
  targets: ["posts", "pages"],
  readers: {
    readRules: async () => ({ patterns: {} }),
    readStructuredDataRules: async () => ({ brand: {}, types: {} }),
    readSocialCardRules: async () => ({}),
  },
};

/**
 * A route context for a caller who may read `readable`, or no caller at
 * all, whose collections' read rules admit only the entries in `own`.
 */
function context(
  readable: string[] | null,
  own: string[] = ["1", "2", "3"]
): PluginRouteContext {
  return {
    user: readable === null ? null : { id: "u1" },
    services: {
      collections: {
        count: async (
          _slug: string,
          _options: unknown,
          opts: { as?: string }
        ) => {
          calls.reads.push(opts.as ?? "system");
          return own.length;
        },
        listEntries: async (
          _slug: string,
          options: { where: { id: { in: string[] } } },
          opts: { as?: string }
        ) => {
          calls.reads.push(opts.as ?? "system");
          return {
            data: options.where.id.in
              .filter(id => own.includes(id))
              .map(id => ({ id })),
          };
        },
      },
    },
    caller:
      readable === null
        ? null
        : {
            can: async (_action: string, slug: string) =>
              readable.includes(slug),
          },
  } as unknown as PluginRouteContext;
}

const [list, check] = problemRoutes(CHECKS);

async function status(
  route: typeof list,
  readable: string[] | null,
  own?: string[]
): Promise<number> {
  try {
    const response = await route!.handler(
      new Request("http://x/"),
      context(readable, own)
    );
    return response.status;
  } catch (error) {
    return (error as { statusCode: number }).statusCode;
  }
}

beforeEach(() => {
  calls.checked = 0;
  calls.readable = [];
  calls.reads = [];
});

describe("the problem list's routes", () => {
  it("refuse a request with no one signed in", async () => {
    expect(await status(list, null)).toBe(401);
    expect(await status(check, null)).toBe(401);
    expect(calls.checked).toBe(0);
  });

  it("refuse a person who may read none of the types, before checking anything", async () => {
    expect(await status(list, [])).toBe(403);
    expect(await status(check, ["other"])).toBe(403);
    expect(calls.checked).toBe(0);
  });

  it("answer a reader with the pages of the types they may read", async () => {
    expect(await status(list, ["posts"])).toBe(200);
    expect(calls.readable).toEqual(["posts:1", "posts:2"]);
    expect(await status(check, ["posts", "pages"])).toBe(200);
    expect(calls.checked).toBe(1);
    expect(calls.readable).toEqual(["pages:3", "posts:1", "posts:2"]);
  });

  it("answer only the entries a read rule admits, asked as the caller", async () => {
    // The caller may read posts, but their read rule admits only their own.
    expect(await status(list, ["posts", "pages"], ["1"])).toBe(200);
    expect(calls.readable).toEqual(["posts:1"]);
    // Entries counted as the caller too.
    expect(calls.counted).toBe(1);
    expect(new Set(calls.reads)).toEqual(new Set(["user"]));
  });

  it("name only the content types the caller may read", async () => {
    expect(await status(list, ["posts"])).toBe(200);
    expect(calls.types).toEqual(["posts"]);
  });

  it("ask to try again while the address record catches up, before checking", async () => {
    ready.record = false;
    try {
      expect(await status(check, ["posts"])).toBe(503);
      expect(calls.checked).toBe(0);
      // The list itself still answers.
      expect(await status(list, ["posts"])).toBe(200);
    } finally {
      ready.record = true;
    }
  });
});
