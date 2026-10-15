/**
 * A production boot refuses a database that has not applied commerce's
 * migrations.
 *
 * In development the push creates commerce's tables at boot, so nothing is
 * ever behind there. In production only the migration modules create them,
 * and a database that has not run them would fail at the first cart request
 * instead. Core's gate refuses it at boot, but only for a plugin that
 * declares a `schemaVersion`, which is what this pins for commerce.
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
    it("refuses a database whose commerce schema is behind the plugin's", async () => {
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
        "PLUGIN_SCHEMA_BEHIND"
      );
    });
  }
);
