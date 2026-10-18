/**
 * A boot on a database that lacks a core table says so, and keeps booting.
 *
 * A database is set up once, and a core table a later release adds reaches it
 * only through `nextly migrate`. Without that step the boot used to succeed in
 * silence, and the first document delete failed on the missing table. The
 * boot's core-schema check now names every missing core table and the command
 * that creates them, in one warning, beside the warning for missing columns.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { warnIfCoreSchemaIsBehind } from "../first-run";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Run the boot's check as boot runs it, keeping what it warns. */
async function bootWarnings(
  options: { coreReconciledThisBoot?: boolean } = {}
): Promise<string[]> {
  const warnings: string[] = [];
  await warnIfCoreSchemaIsBehind(
    current!.adapter as unknown as Parameters<
      typeof warnIfCoreSchemaIsBehind
    >[0],
    {
      debug: () => undefined,
      info: () => undefined,
      warn: (message: string) => {
        warnings.push(message);
      },
      error: () => undefined,
    },
    // Generous: what is under test is what the check says, not whether it
    // beats boot's deadline on a loaded machine.
    60_000,
    undefined,
    options
  );
  return warnings;
}

describe.each(getConfiguredTestDialects())(
  "a boot on a database missing core tables (integration, %s)",
  dialect => {
    it("warns nothing about tables on a database that has them all", async () => {
      current = await createTestNextly({ dialect });
      const warnings = await bootWarnings();
      expect(warnings.filter(w => w.includes("missing tables"))).toEqual([]);
    });

    it("names every missing core table, and the command, in one warning", async () => {
      current = await createTestNextly({ dialect });
      for (const table of ["nextly_version_views", "nextly_version_pins"]) {
        await current.adapter.executeQuery(`DROP TABLE ${table}`);
      }

      const warnings = (await bootWarnings()).filter(w =>
        w.includes("missing tables")
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("nextly_version_pins");
      expect(warnings[0]).toContain("nextly_version_views");
      expect(warnings[0]).toContain("nextly migrate");
    });

    it("says nothing about missing tables when this boot creates them itself", async () => {
      current = await createTestNextly({ dialect });
      for (const table of ["nextly_version_views", "nextly_version_pins"]) {
        await current.adapter.executeQuery(`DROP TABLE ${table}`);
      }

      // The development apply, or production's boot migrations, runs after
      // this check and creates them: telling the operator to run
      // `nextly migrate` would be wrong.
      const warnings = await bootWarnings({ coreReconciledThisBoot: true });
      expect(
        warnings.filter(
          w => w.includes("missing tables") || w.includes("missing columns")
        )
      ).toEqual([]);
    });
  }
);
