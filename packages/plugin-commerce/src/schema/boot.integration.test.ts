/**
 * A production boot refuses a database commerce was never installed on.
 *
 * In development the push creates commerce's tables at boot, so nothing is
 * ever missing there. In production only the install creates them
 * (`nextly plugins install`, which applies the migration modules and records
 * the install), and a database without them would fail at the first cart
 * request instead. Core refuses a configured plugin with no install record
 * before anything else at boot, on every dialect.
 *
 * The schema-version gate, which refuses an installed database behind the
 * schema commerce declares, is reached only past this one, so it is pinned by
 * the upgrade test, which makes such a database with the real commands.
 *
 * @module schema/boot.integration.test
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "@nextlyhq/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { commerce } from "../plugin";

describe.each(getConfiguredTestDialects())(
  "commerce at a production boot (%s)",
  (dialect: TestDialect) => {
    it("refuses a database commerce was never installed on", async () => {
      // What a production boot requires before it reaches the schema gate. A
      // throwaway secret for this boot alone, never a real one.
      const production: Record<string, string> = {
        NODE_ENV: "production",
        NEXTLY_SECRET: "test-only-secret-for-the-boot-gate-0123456789",
        NEXT_PUBLIC_APP_URL: "http://localhost",
      };
      const previous = Object.fromEntries(
        Object.keys(production).map(key => [key, process.env[key]])
      );
      Object.assign(process.env, production);
      let failure: unknown;
      try {
        const booted = await createTestNextly({
          dialect,
          plugins: [commerce({ currency: "USD" })],
        });
        await booted.destroy();
      } catch (error) {
        failure = error;
      } finally {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
      expect(NextlyError.is(failure) ? failure.code : String(failure)).toBe(
        "PLUGIN_NOT_INSTALLED"
      );
    });
  }
);
