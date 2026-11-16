/**
 * Which errors a dry run reports as the real run's refusal and exits 0 on:
 * only those a plan's own checks raise. An error that means the plan could not
 * be worked out at all, such as a database that cannot be reached, fails the
 * dry run as it fails the real run, with exit 1.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { CliError } from "../../errors/cli-error";
import { dryRunRefusalOf } from "../migrate-create";

describe("dryRunRefusalOf", () => {
  it("reports a check's refusal in the real run's words", () => {
    const refused = NextlyError.validation({
      errors: [
        {
          code: "FIELD_NAME_DUPLICATE",
          path: "fields",
          message: "Two fields would become one column.",
        },
      ],
    });
    expect(dryRunRefusalOf(refused)).toBe(refused.publicMessage);
  });

  it.each([
    "PLUGIN_MIGRATION_ADDS_UNFILLABLE_COLUMN",
    "PLUGIN_MIGRATION_DROPS_CREATED_SCHEMA",
    "PLUGIN_SCHEMA_VERSION_NOT_ADVANCED",
    "NEXTLY_LEGACY_BOOKKEEPING_DETECTED",
  ])("reports the plan refusal %s", code => {
    const refused = new NextlyError({
      code,
      publicMessage: `refused: ${code}`,
    });
    expect(dryRunRefusalOf(refused)).toBe(`refused: ${code}`);
  });

  it("does not take a database that cannot be reached for a refusal", () => {
    const unreachable = new CliError("DATABASE_UNREACHABLE", {
      what: "Could not connect to the database.",
      why: "The connection was refused.",
      next: "Check DATABASE_URL.",
    });
    expect(dryRunRefusalOf(unreachable)).toBeUndefined();
  });

  it("does not take an internal or foreign error for a refusal", () => {
    expect(dryRunRefusalOf(NextlyError.internal())).toBeUndefined();
    expect(dryRunRefusalOf(new TypeError("boom"))).toBeUndefined();
  });
});
