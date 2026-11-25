/**
 * A repeater, a group and a field-group (component) field keep one structure in every language:
 * their rows, order and shared values are the same everywhere, and only the fields inside them
 * that are translatable are translated, row by row. No field type offers a structure of its own
 * per language, so `localized: true` on one of these containers, which once kept a whole tree per
 * language, is refused, naming the field, where it is, and the fix: mark the fields inside it
 * `localized: true`, which the upgrade keeps each language's values for.
 *
 * The plausible broken configurations: accepting the flag and quietly keeping a tree per language,
 * or accepting it and quietly ignoring it, so the developer believes a choice was honoured.
 */
import { describe, expect, it } from "vitest";

import { validateFieldGroupConfig } from "../../field-groups/config/validate-field-group";
import { validateSingleConfig } from "../../singles/config/validate-single";
import type { SingleConfig } from "../../singles/config/types";
import { fieldGroup, group, repeater, text } from "../fields/helpers";
import type { CollectionConfig } from "./define-collection";
import { validateCollectionConfig } from "./validate-config";

type Fields = CollectionConfig["fields"];

/** Each container type, marked translatable as a whole. */
const markedContainers: Record<string, () => Fields> = {
  repeater: () =>
    [
      repeater({
        name: "slides",
        localized: true,
        fields: [text({ name: "caption" })],
      } as never),
    ] as Fields,
  group: () =>
    [
      group({
        name: "seo",
        localized: true,
        fields: [text({ name: "title" })],
      } as never),
    ] as Fields,
  component: () =>
    [
      fieldGroup({ name: "hero", component: "card", localized: true } as never),
    ] as Fields,
};

/** Each entity kind's refusals. */
const refusals = {
  collection: (fields: Fields) =>
    validateCollectionConfig({ slug: "posts", fields }).errors,
  single: (fields: Fields) =>
    validateSingleConfig({ slug: "notice", fields } as unknown as SingleConfig)
      .errors,
  "field group": (fields: Fields) =>
    validateFieldGroupConfig({ slug: "panel", fields } as never).errors,
};

describe.each(Object.entries(refusals))(
  "a %s marking a container translatable as a whole",
  (_kind, errorsOf) => {
    it.each(Object.entries(markedContainers))(
      "refuses a %s marked localized, naming it and the fields inside as the fix",
      (_type, fields) => {
        expect(errorsOf(fields())).toContainEqual(
          expect.objectContaining({
            code: "FIELD_STRUCTURE_NOT_TRANSLATABLE",
            path: "fields[0].localized",
            message: expect.stringMatching(
              /"(slides|seo|hero)" \([^)]+\)[\s\S]*mark the fields inside "(slides|seo|hero)" `localized: true` instead; the upgrade \(`nextly migrate`\) keeps each language's values\./
            ),
          })
        );
      }
    );

    // The control: the same containers unmarked, a field inside one marked, and a container
    // marked `localized: false` (which asks for nothing a shared structure does not give) pass.
    it("accepts them unmarked, with a field inside marked localized, or marked false", () => {
      const codes = errorsOf([
        repeater({
          name: "slides",
          fields: [text({ name: "caption", localized: true } as never)],
        }),
        group({
          name: "seo",
          localized: false,
          fields: [text({ name: "title" })],
        } as never),
        fieldGroup({ name: "hero", component: "card" } as never),
      ] as Fields).map(error => error.code);
      expect(codes).not.toContain("FIELD_STRUCTURE_NOT_TRANSLATABLE");
    });
  }
);
