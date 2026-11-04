/**
 * Drawing a page reads and never writes: the helper a published route calls
 * per request answers which Layout a page gets, and leaves a lost default to
 * the repair sweep rather than queueing work from a visitor's request.
 */
import { describe, expect, it } from "vitest";

import { effectiveLayoutFor } from "./effective-layout";
import type { DefaultLayoutDirectApi } from "./store";

/**
 * A Direct API whose settings name `defaultLayout` and whose published Layouts
 * are `published`. Every write it is asked for is recorded, so a test can show
 * that none was.
 */
function siteReading(args: {
  defaultLayout: string | null;
  published: readonly string[];
}): { nextly: DefaultLayoutDirectApi; writes: string[] } {
  const writes: string[] = [];
  const nextly = {
    findSingle: async () => ({ defaultLayout: args.defaultLayout }),
    find: async ({ where }: { where: { id: { in: string[] } } }) => ({
      items: where.id.in
        .filter(id => args.published.includes(id))
        .map(id => ({ id })),
      meta: { hasNext: false },
    }),
    findByID: async () => {
      writes.push("findByID");
      return null;
    },
    create: async () => {
      writes.push("create");
      return { item: {} };
    },
    update: async () => {
      writes.push("update");
      return { item: {} };
    },
    updateSingle: async () => {
      writes.push("updateSingle");
      return {};
    },
    jobs: {
      queue: async () => {
        writes.push("jobs.queue");
        return {};
      },
    },
  } as unknown as DefaultLayoutDirectApi;
  return { nextly, writes };
}

const slugs = { layouts: "layouts", settings: "page-builder-settings" };

describe("effectiveLayoutFor", () => {
  it("answers no regions for a site whose default is not published, and writes nothing", async () => {
    const { nextly, writes } = siteReading({
      defaultLayout: "main",
      published: [],
    });

    expect(await effectiveLayoutFor({}, { nextly, slugs })).toEqual({
      kind: "none",
      reason: "no-default",
    });
    expect(writes).toEqual([]);
  });

  it("answers the default for a page naming nothing, and writes nothing", async () => {
    const { nextly, writes } = siteReading({
      defaultLayout: "main",
      published: ["main"],
    });

    expect(await effectiveLayoutFor({}, { nextly, slugs })).toEqual({
      kind: "layout",
      id: "main",
      source: "default",
    });
    expect(writes).toEqual([]);
  });
});
