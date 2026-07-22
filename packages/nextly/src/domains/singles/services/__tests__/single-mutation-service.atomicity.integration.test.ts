/**
 * Proof that a component-save failure rolls back a Single's scalar update.
 *
 * `SingleMutationService.update()` used to run the scalar `adapter.update`
 * and `ComponentDataService.saveComponentDataInTransaction` as separate
 * operations — a component-save failure left the scalar change committed
 * with no way to undo it. The fix wraps both in one `adapter.transaction(...)`
 * so a component failure aborts the scalar update too.
 *
 * A single with a component field can't be expressed by the typed
 * `single()`/`component()` config helpers alone in a way that lets this
 * suite drop the component's physical table afterward and still resolve it
 * through the registry, so this builds a REAL Builder single + component via
 * `seedBuilderSingle`/`seedBuilderComponent` (the same two-phase recipe used
 * by builder-extend.integration.test.ts's single/component parity suite):
 * seed the component, then the single (its `type: "component"` field is
 * `"skip"`-classified — no physical column, see field-column-descriptor.ts —
 * so seeding order relative to the single doesn't matter for DDL, but the
 * component must exist before any write attempts to resolve it), reset DI
 * without disconnecting the adapter, then reboot on the SAME adapter so
 * `singleEntryService` resolves the seeded single/component through the
 * registry.
 *
 * Failure injection: after establishing an initial value via one successful
 * update, `DROP TABLE comp_hero` so the next update's
 * `saveComponentDataInTransaction` call throws from inside the same
 * transaction as the scalar update.
 *
 * Unlike `CollectionService.createEntry`/`updateEntry` (which throw a
 * `NextlyError` on failure), `SingleEntryService.update()` catches every
 * error internally and returns `{ success: false, ... }` — see
 * `single-mutation-service.ts`'s outer try/catch. So the assertion here
 * checks `result.success`, not `rejects.toThrow()`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { clearServices } from "../../../../di/register";
import {
  seedBuilderComponent,
  seedBuilderSingle,
} from "../../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { SingleEntryService } from "../single-entry-service";

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

/**
 * Recipe: seed the `hero` component then the `preferences` single (carrying a
 * component field that embeds `hero`) on a first boot, reset DI without
 * disconnecting the in-memory adapter, then reboot on the SAME adapter so
 * `singleEntryService` resolves the seeded single/component through the
 * registry (mirrors builder-extend.integration.test.ts's single/component
 * parity setup).
 */
async function seedSettingsWithHero(): Promise<{
  singles: SingleEntryService;
}> {
  handle = await createTestNextly({});
  const adapter = handle.adapter;

  await seedBuilderComponent(adapter, {
    slug: "hero",
    fields: [{ name: "heading", type: "text" }],
  });
  await seedBuilderSingle(adapter, {
    slug: "preferences",
    fields: [
      { name: "headline", type: "text" },
      { name: "seo", type: "component", component: "hero" },
    ],
  });

  clearServices();
  handle = await createTestNextly({ adapter });

  const singles = handle.getService("singleEntryService") as SingleEntryService;

  return { singles };
}

describe("SingleMutationService component-save atomicity (integration)", () => {
  it("update() rolls back the scalar change when the component save fails", async () => {
    const { singles } = await seedSettingsWithHero();
    const adapter = handle!.adapter;

    // Establish an initial value (scalar + component) via a successful
    // update — the component table exists at this point, so this must
    // succeed before the failure is injected.
    const first = await singles.update(
      "preferences",
      { headline: "Original headline", seo: { heading: "Original SEO" } },
      { overrideAccess: true }
    );
    expect(first.success).toBe(true);

    // Drop the component's table so the next update's component save fails
    // from inside the same transaction as the scalar update.
    await adapter.executeQuery(`DROP TABLE "comp_hero"`);

    const second = await singles.update(
      "preferences",
      { headline: "Changed headline", seo: { heading: "Changed SEO" } },
      { overrideAccess: true }
    );

    // update() never throws — every error is caught and mapped to a
    // { success: false } result (see single-mutation-service.ts's catch).
    expect(second.success).toBe(false);

    // Pre-fix, the scalar UPDATE ran on its own operation before the
    // component save, so the headline would have changed here. Post-fix,
    // both share one transaction, so the component failure rolls the
    // headline back too.
    const rows = await adapter.executeQuery<{ headline: string }>(
      `SELECT headline FROM single_preferences LIMIT 1`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].headline).toBe("Original headline");
  });
});
