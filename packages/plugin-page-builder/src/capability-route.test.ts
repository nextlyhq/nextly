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

import { readPatternCapability } from "./capability-route";
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
    expect(asked).toEqual([["create", "site_patterns"]]);
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
    expect(asked).toEqual([["create", PATTERNS_SLUG]]);
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
