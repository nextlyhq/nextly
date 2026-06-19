/**
 * P7d/D56 — the lookup route resolves a source path to its redirect target by
 * querying the redirects collection with a `where` filter (P7a) as system.
 * End-to-end against a live boot, reading the PLUGIN-CONTRIBUTED `redirects`
 * collection (works post-P7b2 harness fix).
 */
import { definePlugin } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { redirects } from "../plugin";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("redirects lookup route (P7d)", () => {
  it("resolves a source path to {to,type}, and null when unknown", async () => {
    const result = redirects();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let services: any;
    const probe = definePlugin({
      name: "@test/redirects-probe",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init: c => {
        services = c.services;
      },
    });
    current = await createTestNextly({ plugins: [result.plugin, probe] });

    await current.nextly.create({
      collection: "redirects",
      data: {
        title: "Old page",
        slug: "old-page",
        fromPath: "/old",
        toPath: "/new",
        type: "301",
      },
    });
    await current.nextly.create({
      collection: "redirects",
      data: {
        title: "External",
        slug: "external",
        fromPath: "/go",
        toPath: "https://example.com",
        type: "302",
      },
    });

    const handler = result.plugin.contributes!.routes![0].handler;
    const lookup = async (from: string): Promise<unknown> => {
      const res = await handler(
        new Request(`http://localhost/lookup?from=${encodeURIComponent(from)}`),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { services } as any
      );
      return res.json();
    };

    expect(await lookup("/old")).toEqual({ to: "/new", type: "301" });
    expect(await lookup("/go")).toEqual({
      to: "https://example.com",
      type: "302",
    });
    expect(await lookup("/missing")).toBeNull();
  });
});
