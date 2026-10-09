/**
 * `migrate:create --plugin` explains a hook that extends a table outside the
 * plugin's own compile — but only if it RECOGNISES that refusal, which it does
 * by reading the draft's message. The refusal here is the one the draft really
 * raises, not a copy of its text, so a change on either side is caught.
 */
import { describe, expect, it } from "vitest";

import {
  createOwnerDraft,
  SchemaDraftStore,
} from "../../../domains/schema/extension/draft";
import { NextlyError } from "../../../errors/nextly-error";
import { missingExtendTarget } from "../migrate-create";

/** The refusal the draft raises for `extendTable` on a table it does not have. */
function draftRefusal(table: string): unknown {
  const draft = createOwnerDraft(
    new SchemaDraftStore({
      dialect: "postgresql",
      coreTableNames: [],
      entities: [],
      pluginPrefixes: new Map([["fx", "fx"]]),
    }),
    { kind: "plugin", id: "fx" }
  );
  try {
    draft.extendTable(table, { indexes: [{ columns: ["id"] }] });
  } catch (error) {
    return error;
  }
  throw new Error("expected the draft to refuse");
}

describe("missingExtendTarget", () => {
  it("names the table from the draft's refusal, continuation and all", () => {
    expect(missingExtendTarget(draftRefusal("dc_posts"))).toBe("dc_posts");
  });

  it("does not claim an unrelated validation error", () => {
    const unrelated = NextlyError.validation({
      errors: [
        {
          path: "fx.schema",
          code: "INVALID",
          message: 'Column "id" is already declared on "fx__notes".',
        },
      ],
    });
    expect(missingExtendTarget(unrelated)).toBeUndefined();
    expect(missingExtendTarget(new Error("boom"))).toBeUndefined();
  });
});
