/**
 * A password or a virtual field is never translatable: a password is one secret for the
 * entry, and a virtual field is stored nowhere, in any language. A configuration that marks
 * one `localized: true` is refused, naming the field, for a collection, a Single and a field
 * group alike, rather than quietly stored as shared.
 */
import { describe, expect, it } from "vitest";

import { validateFieldGroupConfig } from "../../field-groups/config/validate-field-group";
import { validateSingleConfig } from "../../singles/config/validate-single";
import type { SingleConfig } from "../../singles/config/types";
import { password, text } from "../fields/helpers";
import type { CollectionConfig } from "./define-collection";
import { validateCollectionConfig } from "./validate-config";

type Fields = CollectionConfig["fields"];

const passwordMarked = () =>
  [password({ name: "secret", localized: true } as never)] as Fields;
const virtualMarked = () =>
  [text({ name: "teaser", virtual: true, localized: true } as never)] as Fields;

/** Each entity kind's refusals, as `path: code`. */
const refusals = {
  collection: (fields: Fields) =>
    validateCollectionConfig({ slug: "posts", fields }).errors,
  single: (fields: Fields) =>
    validateSingleConfig({ slug: "notice", fields } as unknown as SingleConfig)
      .errors,
  "field group": (fields: Fields) =>
    validateFieldGroupConfig({ slug: "card", fields } as never).errors,
};

describe.each(Object.entries(refusals))(
  "a %s marking a field translatable that never can be",
  (_kind, errorsOf) => {
    it("refuses a password field marked localized, naming it", () => {
      expect(errorsOf(passwordMarked())).toContainEqual(
        expect.objectContaining({
          code: "FIELD_NEVER_TRANSLATABLE",
          path: "fields[0].localized",
          message: expect.stringContaining('"secret"'),
        })
      );
    });

    it("refuses a virtual field marked localized, naming it", () => {
      expect(errorsOf(virtualMarked())).toContainEqual(
        expect.objectContaining({
          code: "FIELD_NEVER_TRANSLATABLE",
          path: "fields[0].localized",
          message: expect.stringContaining('"teaser"'),
        })
      );
    });

    // The control: the same fields not marked, and an ordinary text field marked, pass.
    it("accepts them unmarked, and a text field marked localized", () => {
      const codes = errorsOf([
        password({ name: "secret" }),
        text({ name: "teaser", virtual: true } as never),
        text({ name: "headline", localized: true } as never),
      ] as Fields).map(e => e.code);
      expect(codes).not.toContain("FIELD_NEVER_TRANSLATABLE");
    });
  }
);
