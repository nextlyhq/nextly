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

import { NextlyError } from "nextly";

import { formsCollection, isMissingTarget } from "../forms";
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

/** The error the hook threw, or undefined if it did not throw. */
function rejectionFrom(
  data: Record<string, unknown>,
  operation: string
): unknown {
  try {
    run(data, operation);
  } catch (error) {
    return error;
  }
  return undefined;
}

/** A rejection is typed, and names the field it is about. */
function expectFieldsRejection(error: unknown): void {
  expect(NextlyError.is(error)).toBe(true);
  expect(
    (error as { publicData?: { errors?: { path?: string }[] } }).publicData
      ?.errors?.[0]?.path
  ).toBe("fields");
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
    // Typed, so the rejection reaches the caller as a validation failure with
    // its field issue rather than as a server fault.
    expectFieldsRejection(rejectionFrom({ fields: [] }, "update"));
  });

  it("rejects a create with no fields", () => {
    // On create the patch IS the document, so an absent `fields` really means
    // the form has none.
    expectFieldsRejection(rejectionFrom({ name: "New" }, "create"));
  });

  it("rejects a create with an empty fields array", () => {
    expectFieldsRejection(rejectionFrom({ name: "New", fields: [] }, "create"));
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

describe("isMissingTarget", () => {
  /**
   * The two outcomes a failed lookup can carry, and why the difference is
   * load-bearing: a missing page is the author's to fix and must refuse the
   * save, while an unreadable one must not — refusing there blocks a save a
   * retry would complete and tells the author to change a correct setting.
   *
   * This has been wrong in BOTH directions, so both are pinned.
   */
  it("treats NOT_FOUND as a missing document", () => {
    expect(isMissingTarget({ code: "NOT_FOUND" })).toBe(true);
  });

  it("treats every other failure as unreadable, not missing", () => {
    for (const error of [
      { code: "DATABASE_ERROR" },
      { code: "FORBIDDEN" },
      new Error("connection reset"),
      { message: "Not found." },
      undefined,
      null,
      "NOT_FOUND",
    ]) {
      expect(isMissingTarget(error)).toBe(false);
    }
  });
});

/**
 * The trailing `beforeChange`, which records the moment a form first goes live.
 *
 * `status` here is an ordinary select, not the framework's publish lifecycle,
 * so nothing else writes that down — and without it `closed` stands for two
 * different histories: a form that was released and later stopped, and one
 * created closed that nobody ever saw. The public by-slug endpoint served both.
 */
function beforeChange(): (context: HookContext) => Promise<unknown> {
  const collection = formsCollection({
    formOverrides: { slug: "forms" },
    formSubmissionOverrides: {},
    redirectRelationships: [],
  } as unknown as ResolvedFormBuilderConfig);
  const hooks = (
    collection as unknown as {
      hooks?: {
        beforeChange?: Array<(context: HookContext) => Promise<unknown>>;
      };
    }
  ).hooks;
  const handler = hooks?.beforeChange?.[0];
  if (!handler) throw new Error("forms collection has no beforeChange hook");
  return handler;
}

async function stamped(
  data: Record<string, unknown>,
  originalData?: Record<string, unknown>
): Promise<unknown> {
  await beforeChange()({
    data,
    originalData,
    operation: originalData ? "update" : "create",
  } as unknown as HookContext);
  return data.wentLiveAt;
}

describe("forms beforeChange - recording the first publish", () => {
  it("stamps a form the first time it is published", async () => {
    expect(await stamped({ status: "published" })).toBeInstanceOf(Date);
  });

  it("does not stamp a draft", async () => {
    expect(await stamped({ status: "draft" })).toBeUndefined();
  });

  it("does not stamp a form created closed", async () => {
    // The whole point of the stamp: this form has never been public, and
    // nothing about it should say otherwise.
    expect(await stamped({ status: "closed" })).toBeUndefined();
  });

  it("keeps the original date when a live form is saved again", async () => {
    // FormBuilderView spreads the whole document into every save, so a form
    // edited while live arrives carrying its own stamp. Restamping here would
    // move the date on every keystroke-driven save.
    const first = new Date("2026-01-01T00:00:00Z");
    expect(
      await stamped(
        { status: "published", wentLiveAt: first },
        { status: "published", wentLiveAt: first }
      )
    ).toBe(first);
  });

  it("writes nothing when a closed form is published again", async () => {
    // The stamp is already stored. Leaving it out of the patch is what keeps
    // it: writing a fresh date here would answer "when was this last
    // released", which is not the question the stamp exists for.
    const first = new Date("2026-01-01T00:00:00Z");
    expect(
      await stamped(
        { status: "published" },
        { status: "closed", wentLiveAt: first }
      )
    ).toBeUndefined();
  });

  it("stamps a form whose earlier publish predates the stamp", async () => {
    // The control for the test above: "writes nothing" must not be satisfied
    // by a hook that has stopped writing. A form live before this shipped has
    // no stamp, and its next save is the first chance to record one.
    expect(
      await stamped({ status: "published" }, { status: "published" })
    ).toBeInstanceOf(Date);
  });
});
