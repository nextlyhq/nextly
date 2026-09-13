/**
 * The enumeration and the point lookup must answer the same thing.
 *
 * `registeredContentKinds` scans both registries; `registeredContentKindOf`
 * asks each one about a single name. They are separate reads on purpose, so a
 * caller holding one slug does not pay for a full scan of everything, and that
 * is exactly the shape this repository has watched drift before: one question
 * with two implementations, both looking correct in isolation.
 *
 * A unit test cannot hold them together. Mocking the registries drives both
 * answers from one fixture, so the disagreement being guarded against is
 * precisely the thing the fixture removes. What separates them is the real
 * registries: the enumeration reads a slug projection of every row, the point
 * lookup reads one row by slug, and nothing but a real database can show those
 * two agreeing.
 *
 * The second case is also the durable record of a measurement. System entities
 * are NOT registered content, which is why a caller redacting a relationship
 * target has to ask whether the target is WITHHELD rather than whether it is
 * readable: keyed on readability, `users` and the media library look exactly
 * like a collection the caller was refused.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../config";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";

import {
  registeredContentKindOf,
  registeredContentKinds,
} from "./registered-content-slugs";

const posts = defineCollection({
  slug: "posts",
  fields: [text({ name: "title" })],
});
const notes = defineCollection({
  slug: "notes",
  fields: [text({ name: "body" })],
});
const homepage = defineSingle({
  slug: "homepage",
  fields: [text({ name: "headline" })],
});

let harness: TestNextly | undefined;

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

beforeEach(async () => {
  harness = await createTestNextly({
    collections: [posts, notes],
    singles: [homepage],
  });
});

describe("the two registry readings agree", () => {
  it("gives the same kind for every registered slug", async () => {
    const enumerated = await registeredContentKinds();

    // The control, and it is two assertions rather than one. An empty map
    // satisfies the loop below perfectly, and so does a map that enumerated
    // something other than what this install declared, so the population is
    // named before it is judged.
    expect(
      enumerated.size,
      "the enumeration returned nothing, so the agreement loop below examines " +
        "nothing either"
    ).toBeGreaterThan(0);
    expect([...enumerated.keys()]).toEqual(
      expect.arrayContaining(["posts", "notes", "homepage"])
    );

    for (const [slug, kind] of enumerated) {
      expect(await registeredContentKindOf(slug), slug).toBe(kind);
    }
  });

  it("tells a collection from a single rather than answering from one registry", async () => {
    // A point lookup that asked only the collection registry would report the
    // Single as absent, and one that took the first registry to answer would
    // report whichever it happened to ask first. Both directions are checked
    // because only one of them is visible from the loop above.
    expect(await registeredContentKindOf("posts")).toBe("collection");
    expect(await registeredContentKindOf("homepage")).toBe("single");
  });

  it("agrees that a name in neither registry belongs to neither", async () => {
    const enumerated = await registeredContentKinds();

    // A slug nothing ever declared.
    expect(enumerated.has("no-such-entity-anywhere")).toBe(false);
    expect(await registeredContentKindOf("no-such-entity-anywhere")).toBe(
      undefined
    );

    // The system entities, which are real and are not CONTENT. A relationship
    // pointing at one of these must keep its target: they disclose nothing
    // about which collections an install holds, and stripping them would leave
    // every upload field and every relationship to a system entity describing
    // a reference to nothing.
    for (const slug of ["users", "media", "roles", "permissions"]) {
      expect(enumerated.has(slug), `${slug} in the enumeration`).toBe(false);
      expect(
        await registeredContentKindOf(slug),
        `${slug} in the point lookup`
      ).toBe(undefined);
    }
  });
});
