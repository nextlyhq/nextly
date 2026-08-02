import { allSupports } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { AUTHORING_KEYS } from "./block-supports.test-d";

describe("the authoring vocabulary matches the registry's", () => {
  it("accepts exactly the supports registration accepts", () => {
    // Two lists in two packages, and neither can move without the other. A
    // narrower authoring type refuses a capability the registry grants, so a
    // block that would have worked will not compile; a wider one lets a typo
    // through to boot, which is the thing the strict type exists to prevent.
    //
    // The exhaustiveness half is enforced where the constant is declared, in a
    // file the TypeScript project actually includes. This half is the one a
    // type cannot do: it asks the registry, at runtime, what it really accepts.
    expect(Object.keys(AUTHORING_KEYS).sort()).toEqual(
      allSupports()
        .map(support => support.key)
        .sort()
    );
  });
});
