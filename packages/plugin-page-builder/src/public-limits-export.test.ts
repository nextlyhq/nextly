/**
 * Whether the bounds this package re-exports are the ENGINE'S bounds.
 *
 * The rebuild entry points require `limits`, so a host running the engine
 * defaults has to name a value. It cannot reach `@nextlyhq/blocks-engine` by
 * name — that is a dependency of this package rather than of the app, and pnpm
 * does not put a transitive dependency on an app's resolution path — so this
 * package has to supply one.
 *
 * Asserted by REFERENCE identity rather than by value. Two objects holding the
 * same numbers today satisfy a deep-equality check and drift apart the moment
 * the engine changes one, which is the failure a re-export exists to prevent;
 * only identity separates a re-export from a copy that happens to agree.
 *
 * @module public-limits-export.test
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_LIMITS as engineDefaults } from "@nextlyhq/blocks-engine";

import { DEFAULT_LIMITS as publicDefaults } from "./index";

describe("the bounds this package publishes", () => {
  it("are the engine's own object, not a copy of its numbers", () => {
    expect(publicDefaults).toBe(engineDefaults);
  });

  it("carry the fields a caller has to supply", () => {
    // A control on the assertion above: `toBe` would also pass if both sides
    // were undefined, which is what a re-export of a name the engine had
    // renamed would produce. Naming the fields makes that case fail.
    expect(publicDefaults).toEqual(
      expect.objectContaining({
        maxNodes: expect.any(Number),
        maxDepth: expect.any(Number),
        maxBytes: expect.any(Number),
      })
    );
  });
});
