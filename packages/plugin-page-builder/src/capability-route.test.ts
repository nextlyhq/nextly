/**
 * Whether the capability route answers about the KEY question, not a near one.
 *
 * The separating property is not "a permission check runs". A check ran before
 * this route existed — the save itself — and the whole defect is that it ran too
 * late. What this must get right is WHICH resource it asks about: the grant is
 * seeded against the collection a host actually has, so a route asking about the
 * declared name answers correctly on every site that never renamed anything and
 * refuses an author who holds the grant on every site that did. Both fixtures
 * below therefore RENAME the collection, because an un-renamed one cannot tell
 * the two implementations apart.
 */
import { describe, expect, it } from "vitest";

import {
  mayCreateComponent,
  mayUpdatePattern,
  readEditorCapability,
  readPatternCapability,
} from "./capability-route";
import { COMPONENTS_SLUG } from "./collections/components";
import { PATTERNS_SLUG } from "./collections/patterns";

/** What was asked, so a test can assert the question and not only the answer. */
function callerSpy(answer: boolean): {
  ctx: Parameters<typeof readPatternCapability>[0];
  asked: Array<[string, string]>;
} {
  const asked: Array<[string, string]> = [];
  return {
    asked,
    ctx: {
      // RENAMED, deliberately — see the module docblock.
      self: { collections: { [PATTERNS_SLUG]: "site_patterns" } },
      caller: {
        can: async (action: string, resource: string) => {
          asked.push([action, resource]);
          return answer;
        },
      },
    },
  };
}

describe("the pattern capability route", () => {
  it("asks whether the caller may CREATE in the RESOLVED collection", async () => {
    const { ctx, asked } = callerSpy(true);
    await readPatternCapability(ctx);
    // Both halves matter. A route asking `read` would report every author as
    // able to save, and one asking about `patterns` would refuse an author who
    // holds `create-site_patterns` — the false refusal that hides a working
    // feature, which is worse than the late failure this replaces.
    // Both permissions the write needs, about the RESOLVED collection. A route
    // asking `read` would report every author as able to save, and one asking
    // about `patterns` would refuse an author who holds `create-site_patterns`.
    expect(asked).toEqual([
      ["create", "site_patterns"],
      ["publish", "site_patterns"],
    ]);
  });

  it("requires PUBLISH as well, because the save creates a published row", async () => {
    // `save-pattern-route`
    // persists `status: "published"`, and core resolves the publish grant
    // separately from create for that transition — its own docblock says an
    // author without it "is refused by core". An answer naming `create` alone
    // therefore says yes to an author the save refuses, which relocates the
    // defect instead of fixing it.
    const asked: Array<[string, string]> = [];
    const answer = await readPatternCapability({
      self: { collections: { [PATTERNS_SLUG]: "site_patterns" } },
      caller: {
        can: async (a: string, r: string) => {
          asked.push([a, r]);
          return a === "create";
        },
      },
    });
    expect(asked).toContainEqual(["publish", "site_patterns"]);
    expect(answer).toEqual({ mayCreate: false });
  });

  it("stops at the first refusal rather than asking the rest", async () => {
    // The second question costs a permission read, and an author refused the
    // first has already been answered.
    const asked: Array<[string, string]> = [];
    await readPatternCapability({
      self: { collections: {} },
      caller: {
        can: async (a: string, r: string) => {
          asked.push([a, r]);
          return false;
        },
      },
    });
    expect(asked).toEqual([["create", PATTERNS_SLUG]]);
  });

  it("reports what the caller answered, in both directions", async () => {
    await expect(readPatternCapability(callerSpy(true).ctx)).resolves.toEqual({
      mayCreate: true,
    });
    await expect(readPatternCapability(callerSpy(false).ctx)).resolves.toEqual({
      mayCreate: false,
    });
  });

  it("falls back to the declared slug when the host renamed nothing", async () => {
    const asked: Array<[string, string]> = [];
    await readPatternCapability({
      self: { collections: {} },
      caller: {
        can: async (a: string, r: string) => {
          asked.push([a, r]);
          return true;
        },
      },
    });
    expect(asked).toEqual([
      ["create", PATTERNS_SLUG],
      ["publish", PATTERNS_SLUG],
    ]);
  });

  it("refuses a caller nobody identified, without asking", async () => {
    // Unreachable through the route, which is authenticated — but reading a
    // null caller as "allowed" is the direction that offers a control to an
    // anonymous visitor, so it is decided rather than left to the type.
    await expect(
      readPatternCapability({ self: { collections: {} }, caller: null })
    ).resolves.toEqual({ mayCreate: false });
  });
});

describe("whether the caller may open a component in its own view", () => {
  function caller(grants: ReadonlyArray<[string, string]>) {
    const asked: Array<[string, string]> = [];
    return {
      asked,
      ctx: {
        // RENAMED, for the reason the pattern fixture is.
        self: { collections: { [COMPONENTS_SLUG]: "site_components" } },
        caller: {
          can: async (action: string, resource: string) => {
            asked.push([action, resource]);
            return grants.some(([a, r]) => a === action && r === resource);
          },
        },
      },
    };
  }

  it("names the RESOLVED collection to an author who may update it", async () => {
    const { ctx, asked } = caller([
      ["read", "site_components"],
      ["update", "site_components"],
    ]);
    const answer = await readEditorCapability(ctx);
    expect(answer.componentEditing).toEqual({
      collection: "site_components",
      field: "content",
    });
    expect(asked).toContainEqual(["update", "site_components"]);
  });

  it("names a configured store literally", async () => {
    const { ctx } = caller([
      ["read", "my_defs"],
      ["update", "my_defs"],
    ]);
    const answer = await readEditorCapability(ctx, {
      collection: "my_defs",
      field: "definition",
    });
    expect(answer.componentEditing).toEqual({
      collection: "my_defs",
      field: "definition",
    });
  });

  it("answers null to an author who may update but not read them", async () => {
    const { ctx } = caller([["update", "site_components"]]);
    expect((await readEditorCapability(ctx)).componentEditing).toBeNull();
  });

  it("answers null to an author who may only read components", async () => {
    const { ctx } = caller([["read", "site_components"]]);
    expect((await readEditorCapability(ctx)).componentEditing).toBeNull();
    expect(
      (
        await readEditorCapability({
          self: { collections: {} },
          caller: null,
        })
      ).componentEditing
    ).toBeNull();
  });
});

describe("whether the caller may make a component", () => {
  function grants(held: Record<string, boolean>) {
    return {
      self: { collections: { components: "site_components" } },
      caller: {
        can: (action: string, resource: string) =>
          Promise.resolve(held[`${action}-${resource}`] === true),
      },
    };
  }

  it("asks for create AND publish, on the store the host resolved", async () => {
    const both = grants({
      "create-site_components": true,
      "publish-site_components": true,
    });
    expect(await mayCreateComponent(both)).toBe(true);
  });

  it("says no to an author who may create components but not publish them", async () => {
    const createOnly = grants({ "create-site_components": true });
    expect(await mayCreateComponent(createOnly)).toBe(false);
  });

  it("says yes where the store named is the plugin's own components", async () => {
    const both = grants({
      "create-site_components": true,
      "publish-site_components": true,
    });
    expect(
      await mayCreateComponent(both, { collection: "site_components" })
    ).toBe(true);
  });

  it("says no where the host keeps components in a store of its own", async () => {
    const configured = grants({
      "create-blocks_lib": true,
      "publish-blocks_lib": true,
      "create-site_components": true,
      "publish-site_components": true,
    });
    expect(
      await mayCreateComponent(configured, { collection: "blocks_lib" })
    ).toBe(false);
  });
});

describe("whether the caller may update a pattern from a selection", () => {
  function grants(held: Record<string, boolean>) {
    return {
      self: { collections: { [PATTERNS_SLUG]: "site_patterns" } },
      caller: {
        can: (action: string, resource: string) =>
          Promise.resolve(held[`${action}-${resource}`] === true),
      },
    };
  }

  it("asks for read, update AND publish on the patterns the host resolved", async () => {
    expect(
      await mayUpdatePattern(grants({ "update-site_patterns": true }))
    ).toBe(false);
    // Without read, the author could choose no pattern to update.
    expect(
      await mayUpdatePattern(
        grants({ "update-site_patterns": true, "publish-site_patterns": true })
      )
    ).toBe(false);
    expect(
      await mayUpdatePattern(
        grants({
          "read-site_patterns": true,
          "update-site_patterns": true,
          "publish-site_patterns": true,
        })
      )
    ).toBe(true);
  });
});
