/**
 * Which types a reader handed a person may read: core's answer for that
 * person, an API key's scope going with it so the key's grants decide, kept
 * to the types SEO is added to, by the key their pages are kept under.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readableTypesOf } from "./reader";

const asked = vi.fn();
vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  readableContent: async (caller: unknown) => {
    asked(caller);
    return {
      entities: [
        { slug: "posts", kind: "collection" },
        { slug: "notes", kind: "collection" },
        { slug: "home", kind: "single" },
      ],
    };
  },
}));

beforeEach(() => asked.mockReset());

const CHECKS = { targets: ["posts"], singles: ["home"] };

describe("the types a person may read", () => {
  it("keeps those SEO is added to, a Single by its pages' key", async () => {
    const types = await readableTypesOf({ user: { id: "u" } }, CHECKS);
    expect([...types]).toEqual(["posts", "single:home"]);
    expect(asked).toHaveBeenCalledWith({ user: { id: "u" } });
  });

  it("asks with an API key's scope, so its grants decide", async () => {
    const authenticatedScope = {
      actorType: "apiKey" as const,
      permissions: ["read-posts"],
    };
    await readableTypesOf(
      { user: { id: "u", roles: ["editor"] }, authenticatedScope },
      CHECKS
    );
    expect(asked).toHaveBeenCalledWith({
      user: { id: "u", roles: ["editor"] },
      authenticatedScope,
    });
  });
});
