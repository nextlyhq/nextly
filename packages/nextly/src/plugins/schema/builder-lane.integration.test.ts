/**
 * P8 — runtime Builder-lane boot wiring (register.ts defer → reconcile).
 *
 * A plugin `contributes.extend` whose target isn't a code/plugin entity is
 * DEFERRED past Layer 0c (no longer thrown there, so a Builder-made target can
 * resolve), then reconciled against the Builder entities loaded from the DB.
 *
 * When the target exists in NEITHER code/plugin NOR the (DB) Builder set it is
 * now GRACEFUL by default (warn + skip — covered in builder-extend.integration)
 * so a typo can't take the whole app down. STRICT mode
 * (`NEXTLY_STRICT_PLUGIN_TARGETS=1`) restores the fail-fast throw — this test
 * guards that path, so a typo is still catchable where you want it (CI/prod).
 */
import { afterEach, describe, expect, it } from "vitest";

import type { PluginDefinition } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

const textField = (name: string) => ({ name, type: "text" });

describe("Builder schema lane — runtime boot", () => {
  let handle: TestNextly | undefined;
  afterEach(async () => {
    await handle?.destroy();
    handle = undefined;
    delete process.env.NEXTLY_STRICT_PLUGIN_TARGETS;
  });

  it("strict mode: defers an extend target past Layer 0c, then fails fast at the DB-aware reconcile when it is neither code/plugin nor Builder", async () => {
    process.env.NEXTLY_STRICT_PLUGIN_TARGETS = "1";
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
