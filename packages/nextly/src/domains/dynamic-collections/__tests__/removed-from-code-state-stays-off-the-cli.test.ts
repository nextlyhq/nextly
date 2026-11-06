/**
 * The removed-from-code state reader, which a request runs when it lists a
 * collection or Single removed from code, loads none of the CLI's commands,
 * even through the `import()`s it runs on that request.
 *
 * A command module brings the CLI's own dependencies (its prompts, its
 * output, every other command it registers) into the server, and a server
 * bundle may not carry them. The one CLI module the reader may load is the
 * migration discovery, a leaf that reads a folder's file names and imports
 * nothing of the CLI itself, which the schema domain loads at runtime too.
 *
 * The walk is the shared static one (`__tests__/source-import-walk.ts`), with
 * every `import()` followed, since the reader loads its helpers that way.
 *
 * @module domains/dynamic-collections/__tests__/removed-from-code-state-stays-off-the-cli.test
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  chainTo,
  fromSrc,
  loads,
  SRC,
} from "../../../__tests__/source-import-walk";

const READER = join(
  SRC,
  "domains/dynamic-collections/services/removed-from-code-state.ts"
);

/** The one CLI module the reader may load, named from `src`. */
const ALLOWED_CLI = ["cli/utils/migration-discovery.ts"];

describe("the removed-from-code state reader", () => {
  it("loads no CLI module but the migration discovery, on the request path", () => {
    const walk = loads(READER, true);
    const reached = [...walk.from.keys()]
      .filter(module => fromSrc(module).startsWith("cli/"))
      .filter(module => !ALLOWED_CLI.includes(fromSrc(module)))
      .map(module => chainTo(walk, module));
    expect(reached).toEqual([]);
  });

  it("loads nothing the walk cannot read or resolve", () => {
    expect(loads(READER, true).problems).toEqual([]);
  });

  it("is the control: the walk follows the reader's import() and finds the CLI leaf", () => {
    // Without these the first case passes as well for a walk that followed
    // nothing: the drop guard is reached only through an `import()`, and the
    // discovery is the CLI module the reader does load.
    const walk = loads(READER, true);
    expect(
      walk.from.has(join(SRC, "domains/schema/ownership/drop-guard.ts"))
    ).toBe(true);
    expect(walk.from.has(join(SRC, "cli/utils/migration-discovery.ts"))).toBe(
      true
    );
    // And what the discovery imports stays off the CLI too.
    const leaf = loads(join(SRC, "cli/utils/migration-discovery.ts"), true);
    expect(
      [...leaf.from.keys()]
        .map(fromSrc)
        .filter(module => module.startsWith("cli/"))
    ).toEqual(["cli/utils/migration-discovery.ts"]);
  });
});
