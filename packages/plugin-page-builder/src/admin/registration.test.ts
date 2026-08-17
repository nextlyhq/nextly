/**
 * That the component a field NAMES is a component the admin can FIND.
 *
 * The blocks field declares its control as a specifier string
 * (`BLOCKS_FIELD_COMPONENT`), and the admin resolves that string through the
 * component registry at render time. Nothing type-checks the link, because a
 * string is not a reference: the field compiles, the entry builds, the suite
 * passes, and the field renders as an empty group carrying its label and
 * nothing else — in the admin, at the moment an author opens the form.
 *
 * That is not hypothetical. This entry was once rewritten to export the
 * component without registering it, and every existing test stayed green while
 * every blocks field in the product rendered blank.
 *
 * The two declarations cannot be collapsed into one: the field lives in the
 * Node-safe "." bundle and the component only exists behind this entry's client
 * boundary, so importing the constant there would pull React into the
 * isomorphic bundle. Since the duplication is forced, this asserts the two
 * agree.
 *
 * @module admin/registration.test
 */
import { describe, expect, it, vi } from "vitest";

import { BLOCKS_FIELD_COMPONENT } from "../fields/blocksField";

// Captured rather than reconstructed. The assertion is about what this module
// ACTUALLY registers on load, so a test that rebuilt the map from its own
// literal would keep passing after the real call stopped happening — which is
// precisely the defect this file exists to catch.
const registered: Record<string, unknown> = {};
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  registerComponents: (map: Record<string, unknown>) => {
    Object.assign(registered, map);
  },
  registerKnownPlugin: () => undefined,
}));

describe("the admin entry's component registration", () => {
  it("registers the exact specifier the blocks field declares", async () => {
    // Imported for its side effect, after the mock is in place.
    await import("./index");

    // The specifier, not merely "something was registered" — a map with one
    // unrelated entry satisfies a count and leaves the field unresolvable.
    expect(Object.keys(registered)).toContain(BLOCKS_FIELD_COMPONENT);
    expect(registered[BLOCKS_FIELD_COMPONENT]).toBeTypeOf("function");
  });

  it("registers nothing it does not export, so no specifier dangles", async () => {
    await import("./index");
    const entry = await import("./index");

    // Every registered path must name an export of this module. A registration
    // pointing at a component that was deleted resolves to `undefined` and
    // renders blank, which is the same failure from the other direction.
    for (const path of Object.keys(registered)) {
      const name = path.split("#")[1];
      expect(name, `${path} has no #ComponentName`).toBeTruthy();
      expect(
        entry,
        `${path} names an export this module does not have`
      ).toHaveProperty(name as string);
    }
  });
});
