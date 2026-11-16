/**
 * The Design section's startup read is the read the section makes: the
 * admin fills the declared template from the edit page's ids, and the path it
 * asks for must be the one `entryDesignPath` builds, or the started read and
 * the section's own are two different reads.
 */
import { fillPlaceStartupPath } from "nextly/config";
import { describe, expect, it } from "vitest";

import {
  ENTRY_DESIGN_STARTUP_PATH,
  entryDesignPath,
} from "./entry-designs-contract";

describe("the Design section's startup read", () => {
  it.each([
    ["plain ids", "posts", "1f670d21-a232-459c-95dc-1ab2eba1e996"],
    ["ids that need encoding", "blog posts", "a/b?c&d=e"],
  ])("fills to the section's own path, for %s", (_case, collection, entry) => {
    expect(
      fillPlaceStartupPath(ENTRY_DESIGN_STARTUP_PATH, {
        collection,
        entryId: entry,
      })
    ).toBe(entryDesignPath(collection, entry));
  });

  it("is not started for a new entry, which has no id yet", () => {
    expect(
      fillPlaceStartupPath(ENTRY_DESIGN_STARTUP_PATH, {
        collection: "posts",
        entryId: null,
      })
    ).toBeNull();
  });
});
