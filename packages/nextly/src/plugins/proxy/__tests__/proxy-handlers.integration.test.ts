/**
 * A plugin's proxy handler, registered at boot with the plugin's own context,
 * reaches the database from the Proxy on every dialect: it answers a request
 * from a row it reads through its context, and a row saved afterwards decides
 * the very next request.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { text } from "../../../collections/fields/helpers";
import type { SanitizedNextlyConfig } from "../../../collections/config/define-config";
import { createNextlyProxy } from "../../../runtime/proxy";
import { definePlugin } from "../../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A plugin that sends each address it keeps to another. */
const movesPlugin = definePlugin({
  name: "@test/moves",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    collections: [
      defineCollection({
        slug: "test_moves",
        fields: [text({ name: "source" }), text({ name: "target" })],
      }),
    ],
    proxy: [
      {
        name: "moves",
        async handle(request, ctx) {
          const path = new URL(request.url).pathname;
          const { data } = await ctx.services.ownCollections.listEntries(
            "test_moves",
            { where: { source: { equals: path } }, pagination: { limit: 1 } }
          );
          const [move] = data as { target?: string }[];
          if (move?.target === undefined)
            return { headers: { "x-moves": "none" } };
          return {
            response: Response.redirect(new URL(move.target, request.url), 301),
          };
        },
      },
    ],
  },
});

/** The Proxy as an app wires it, on a Nextly the test has started. */
function proxyFor(): (request: Request) => Promise<Response | undefined> {
  return createNextlyProxy({} as SanitizedNextlyConfig, {
    start: async () => undefined,
    next: () => () => new Response(null, { headers: { "x-next": "1" } }),
  });
}

describe.each(getConfiguredTestDialects())("proxy handlers (%s)", dialect => {
  it("answers from the database, and a row saved now decides the next request", async () => {
    current = await createTestNextly({ dialect, plugins: [movesPlugin] });
    const proxy = proxyFor();

    const before = await proxy(new Request("https://example.com/old"));
    expect(before?.headers.get("x-moves")).toBe("none");
    expect(before?.headers.get("x-next")).toBe("1");

    await current.nextly.create({
      collection: "test_moves",
      data: { source: "/old", target: "/new" },
    });

    const after = await proxy(new Request("https://example.com/old"));
    expect(after?.status).toBe(301);
    expect(after?.headers.get("location")).toBe("https://example.com/new");
  });
});
