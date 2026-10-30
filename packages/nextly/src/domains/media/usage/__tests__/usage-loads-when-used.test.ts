/**
 * The service registry, the CLI and the route handler load the media usage
 * record's code and the media library's query only when a write records or a
 * reader reads, never when they are loaded.
 *
 * Every test that reaches the registry loads what it loads, and the module
 * budget counts those files: a module the registry loads at once is a module
 * every heavy test loads. So the writers ask for the record's code with an
 * `import()` when a write records, the media services ask for the query when
 * they read, and what a request may ask for is parsed by the schemas in
 * `types/media`, which the registry loads anyway. This names the edge at the
 * commit that adds one back; the budget stays the gate.
 *
 * @module domains/media/usage/__tests__/usage-loads-when-used.test
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { chainTo, loads, SRC } from "../../../../__tests__/static-import-walk";

/** What the registry, the CLI and the route handler load with them. */
const ENTRIES = ["di/register.ts", "cli/program.ts", "routeHandler.ts"];

/** What each of them loads only when it runs, named from `src`. */
const LOADED_WHEN_USED = [
  "domains/media/usage/media-usage-store.ts",
  "domains/media/usage/stored-document-usage.ts",
  "domains/media/usage/media-references.ts",
  "domains/media/usage/email-template-usage.ts",
  "domains/media/usage/reindex-usage.ts",
  "domains/singles/services/single-media-usage.ts",
  "domains/media/media-library-query.ts",
];

describe("the media usage record and the media library's query", () => {
  it("are loaded by none of the registry, the CLI or the route handler at once", () => {
    const reached = ENTRIES.flatMap(entry => {
      const walk = loads(join(SRC, entry));
      return LOADED_WHEN_USED.map(module => join(SRC, module))
        .filter(module => walk.from.has(module))
        .map(module => chainTo(walk, module));
    });
    expect(reached).toEqual([]);
  });

  it("is the control: each is reached once the imports made when a write or a read runs are followed", () => {
    // So a module renamed away, or a walk that resolves nothing, fails here
    // rather than making the first case pass by finding nothing.
    const walk = loads(join(SRC, "di/register.ts"), true);
    const missed = LOADED_WHEN_USED.filter(
      module => !walk.from.has(join(SRC, module))
    );
    expect(missed).toEqual([]);
    // And the walk reads the registry's services at once: the services that
    // ask for these modules are themselves loaded with it.
    const eager = loads(join(SRC, "di/register.ts"));
    expect(
      eager.from.has(join(SRC, "domains/versions/entity-teardown.ts"))
    ).toBe(true);
    expect(eager.from.has(join(SRC, "services/media.ts"))).toBe(true);
    expect(eager.problems).toEqual([]);
  });
});
