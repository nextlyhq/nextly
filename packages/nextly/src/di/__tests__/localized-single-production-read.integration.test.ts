/**
 * A localized single read at a production boot, on every dialect.
 *
 * Its translatable fields live only on the `_locales` companion, as the
 * migrations create it. A production boot registered the single's main table
 * without its `localized` switch, so the table it read from listed those
 * fields as columns, and every read failed with "no such column". In
 * development the reload registered the tables again correctly, which hid it.
 *
 * This harness syncs the schema as development does, which also registers
 * the tables again, so the test then applies the production boot's own
 * registration (`registerConfigTablesInResolver`) to the live registry, as a
 * `next start` leaves it, before reading.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../config";
import type { SchemaRegistry } from "../../database/schema-registry";
import { registerConfigTablesInResolver } from "../register";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";

/** What a production boot requires. A throwaway secret for this boot alone. */
const PRODUCTION: Record<string, string> = {
  NODE_ENV: "production",
  NEXTLY_SECRET: "test-only-secret-for-the-boot-gate-0123456789",
  NEXT_PUBLIC_APP_URL: "http://localhost",
};

let handle: TestNextly | undefined;
let restore: Record<string, string | undefined> = {};

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
  for (const [key, value] of Object.entries(restore)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  restore = {};
});

describe.each(getConfiguredTestDialects())(
  "a localized single at a production boot (%s)",
  (dialect: TestDialect) => {
    it("reads its translated and shared fields from where they are stored", async () => {
      restore = Object.fromEntries(
        Object.keys(PRODUCTION).map(key => [key, process.env[key]])
      );
      Object.assign(process.env, PRODUCTION);
      const announcement = defineSingle({
        slug: "announcement",
        localized: true,
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "campaign", localized: false }),
          // Localized by the single's switch, without saying so itself.
          text({ name: "headline" }),
        ],
      });
      handle = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        singles: [announcement],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });

      await handle.nextly.updateSingle({
        slug: "announcement",
        data: { campaign: "spring", headline: "Closed on Friday" },
        overrideAccess: true,
      });
      // The registry as a production boot leaves it.
      await registerConfigTablesInResolver(
        handle.getService("schemaRegistry" as never) as SchemaRegistry,
        { singles: [announcement] } as never,
        handle.adapter as never,
        {}
      );
      const doc = (await handle.nextly.findSingle({
        slug: "announcement",
        overrideAccess: true,
      })) as Record<string, unknown>;

      expect(doc.campaign).toBe("spring");
      expect(doc.headline).toBe("Closed on Friday");
    });
  }
);
