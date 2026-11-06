/**
 * Putting a Layout back from a removal's copy writes the copy whatever the
 * Layout holds now, and says so.
 *
 * A copy is put back on purpose: the removal unpublished the Layout while a
 * page still named it, so the copy is what the Layout must hold again. Each
 * write therefore chooses to overwrite rather than send the version it was
 * read at, and the copy's own stored version is never sent back with it.
 */
import { describe, expect, it, vi } from "vitest";

import { republishFromCopy, type RestoreDeps } from "./restore";

const SLUGS = { layouts: "layouts", settings: "page-builder-settings" };

function depsRecording() {
  const updates: Record<string, unknown>[] = [];
  const nextly = {
    update: vi.fn(async (args: Record<string, unknown>) => {
      updates.push(args);
      return { item: { id: String(args.id) } };
    }),
  } as unknown as RestoreDeps["nextly"];
  return { deps: { nextly, slugs: SLUGS, warn: vi.fn() }, updates };
}

describe("republishing a Layout from its copy", () => {
  it("writes the live row and the working draft as overwrites, never sending the copy's version", async () => {
    const { deps, updates } = depsRecording();
    await republishFromCopy(
      deps,
      "landing",
      {
        live: { id: "landing", title: "Landing", slug: "landing", _rev: "3" },
        draft: { id: "landing", title: "Landing (edited)", _rev: "3" },
      },
      { removal: "token" }
    );

    expect(updates.map(update => update.data)).toEqual([
      expect.objectContaining({
        title: "Landing",
        status: "published",
        _overwrite: true,
      }),
      expect.objectContaining({ title: "Landing (edited)", _overwrite: true }),
    ]);
    for (const update of updates) {
      expect(update.data).not.toHaveProperty("_rev");
    }
  });
});
