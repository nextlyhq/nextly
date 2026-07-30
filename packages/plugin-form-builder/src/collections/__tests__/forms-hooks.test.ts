/**
 * The forms `beforeValidate` hook, against partial updates.
 *
 * "A form must have at least one field" was checked by treating an absent
 * `fields` as an empty one. An update carries the patch rather than the merged
 * document, so renaming a form — or changing any setting that is not its fields
 * — arrived with `fields` undefined and was rejected, even though the form's
 * fields were untouched and still there.
 *
 * Core already documents the rule this now follows: on update only the fields
 * present in the patch are checked, so a required value cannot be blanked but
 * an untouched one is not re-validated.
 *
 * These run against the hook itself rather than a booted instance, because that
 * is the level the decision is made at and the level a future edit would break.
 */
import type { HookContext } from "nextly";
import { describe, expect, it } from "vitest";

import { formsCollection } from "../forms";
import type { ResolvedFormBuilderConfig } from "../../types";

/** The hook under test, as the collection factory produces it. */
function beforeValidate(): (context: HookContext) => unknown {
  const collection = formsCollection({
    formOverrides: { slug: "forms" },
    formSubmissionOverrides: {},
    // Read by the factory while assembling the collection; the hook under test
    // does not consult it, but building the collection at all requires it.
    redirectRelationships: [],
  } as unknown as ResolvedFormBuilderConfig);
  const hooks = (
    collection as unknown as {
      hooks?: { beforeValidate?: Array<(context: HookContext) => unknown> };
    }
  ).hooks;
  const handler = hooks?.beforeValidate?.[0];
  if (!handler) throw new Error("forms collection has no beforeValidate hook");
  return handler;
}

function run(data: Record<string, unknown>, operation: string): unknown {
  return beforeValidate()({ data, operation } as unknown as HookContext);
}

describe("forms beforeValidate", () => {
  it("accepts a partial update that does not touch fields", () => {
    // The regression: a rename carries only `name`, and the form's existing
    // fields are not in the patch.
    expect(() => run({ name: "Renamed" }, "update")).not.toThrow();
  });

  it("still rejects an update that empties the fields", () => {
    // The mirror. Skipping the check whenever `fields` is absent must not also
    // skip it when the patch deliberately sets it to nothing.
    expect(() => run({ fields: [] }, "update")).toThrow(/at least one field/i);
  });

  it("rejects a create with no fields", () => {
    // On create the patch IS the document, so an absent `fields` really means
    // the form has none.
    expect(() => run({ name: "New" }, "create")).toThrow(/at least one field/i);
  });

  it("rejects a create with an empty fields array", () => {
    expect(() => run({ name: "New", fields: [] }, "create")).toThrow(
      /at least one field/i
    );
  });

  it("accepts a create that has fields", () => {
    expect(() =>
      run({ name: "New", fields: [{ name: "email" }] }, "create")
    ).not.toThrow();
  });

  it("accepts an update that replaces the fields", () => {
    expect(() => run({ fields: [{ name: "email" }] }, "update")).not.toThrow();
  });
});
