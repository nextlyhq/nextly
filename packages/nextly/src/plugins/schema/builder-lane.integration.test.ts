/**
 * P8 — runtime Builder-lane boot wiring (register.ts defer → finalize).
 *
 * A plugin `contributes.extend` whose target isn't a code/plugin entity is
 * DEFERRED past Layer 0c (no longer thrown there, so a Builder-made target can
 * resolve), then finalized against the Builder slugs loaded from the DB. When
 * the target exists in NEITHER code/plugin NOR the (DB) Builder set, the boot
 * still fails fast (D7/D12) — this guards that the deferral didn't turn a real
 * typo into a silent pass.
 *
 * The success path (target IS a migrated Builder collection) is covered by
 * composition: `loadDynamicSlugs` (load-dynamic-slugs.integration.test) returns
 * the Builder slugs, and `finalizeDeferredExtendTargets`/`finalizeRelationTargets`
 * (apply-contributions/validate-relations unit tests) pass when the slug is
 * present. A full cross-process e2e (migrate materializes the column → fresh
 * boot CRUDs it) needs a pre-populated DB and is out of the in-memory harness's
 * scope — see the P8 completion note.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { PluginDefinition } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

const textField = (name: string) => ({ name, type: "text" });

describe("Builder schema lane — runtime boot (P8/D3/R2)", () => {
  let handle: TestNextly | undefined;
  afterEach(async () => {
    await handle?.destroy();
    handle = undefined;
  });

  it("defers an extend target past Layer 0c, then fails fast at the DB-aware finalize when it is neither code/plugin nor Builder", async () => {
    const seo: PluginDefinition = {
      name: "@t/seo",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        extend: [
          {
            target: "ghost-pages",
            fields: [textField("metaTitle")],
          },
        ],
      },
    };

    await expect(createTestNextly({ plugins: [seo] })).rejects.toMatchObject({
      code: "NEXTLY_SCHEMA_EXTEND_TARGET_UNKNOWN",
    });
  });
});
