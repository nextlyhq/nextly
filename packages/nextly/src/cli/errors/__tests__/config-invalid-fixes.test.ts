/**
 * The fix `CONFIG_INVALID` adds to a problem follows the failure itself: a field type nothing
 * offers is told to use a built-in type or install the plugin, and a plugin type's option that
 * its own rule refuses gets that rule's sentence alone, the plugin being installed already.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { toCliError } from "../from-thrown";

function reportOf(problem: { path: string; code: string; message: string }) {
  const error = toCliError(
    NextlyError.validation({
      errors: [problem],
      logContext: { reason: "config-invalid" },
    })
  );
  return `${error.what}\n${error.why}\n${error.next}`;
}

describe("the fix CONFIG_INVALID gives a field-type problem", () => {
  it("is to use a built-in type or install the plugin, for a type nothing offers", () => {
    expect(
      reportOf({
        path: "collections[0].score.type",
        code: "FIELD_TYPE_INVALID",
        message:
          "Invalid field type 'acme-rating'. No built-in type, and no installed plugin offers it on this surface.",
      })
    ).toContain("install the plugin that offers this one");
  });

  it("is none beyond the rule's own sentence, for an option the plugin's rule refuses", () => {
    const report = reportOf({
      path: "collections[0].fields[0].policy.kinds",
      code: "FIELD_TYPE_INVALID",
      message: "policy.kinds must name at least one kind.",
    });

    expect(report).toContain("policy.kinds must name at least one kind.");
    expect(report).not.toContain("built-in field type");
  });
});
