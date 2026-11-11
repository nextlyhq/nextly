/**
 * The list's routes answer only a signed-in person who may read one of the
 * types SEO is added to, with the pages of the types they may read, and ask
 * that before a full check runs.
 */
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  checked: 0,
  readable: [] as string[],
}));

vi.mock("../check", () => ({
  checkSite: async () => {
    calls.checked += 1;
  },
  problemList: async (
    _ctx: unknown,
    _checks: unknown,
    canRead: (type: string) => boolean
  ) => {
    calls.readable = ["posts", "pages"].filter(canRead);
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

/** A route context for a caller who may read `readable`, or no caller at all. */
function context(readable: string[] | null): PluginRouteContext {
  return {
    user: readable === null ? null : { id: "u1" },
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
  readable: string[] | null
): Promise<number> {
  try {
    const response = await route!.handler(
      new Request("http://x/"),
      context(readable)
    );
    return response.status;
  } catch (error) {
    return (error as { statusCode: number }).statusCode;
  }
}

beforeEach(() => {
  calls.checked = 0;
  calls.readable = [];
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
    expect(calls.readable).toEqual(["posts"]);
    expect(await status(check, ["posts", "pages"])).toBe(200);
    expect(calls.checked).toBe(1);
    expect(calls.readable).toEqual(["posts", "pages"]);
  });
});
