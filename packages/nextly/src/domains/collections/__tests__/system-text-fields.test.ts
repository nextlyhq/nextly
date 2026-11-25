/**
 * The system `title` and `slug` a collection's entries carry, as its readers are told of them:
 * one value for every language. The plausible broken versions: one that says nothing of
 * translation, which a reader takes for a translated text field, and one that answers for a field
 * the author declared.
 */
import { describe, expect, it } from "vitest";

import {
  SYSTEM_TEXT_FIELD_NAMES,
  withSystemTextFields,
} from "../system-text-fields";

const BODY = { name: "body", type: "text" };

/** What is said of a field's translation. */
const localizedOf = (
  fields: readonly { name?: unknown; localized?: unknown }[],
  name: string
) => fields.find(field => field.name === name)?.localized;

describe("the system title and slug", () => {
  it("are added to a collection that declares neither, as not translated", () => {
    const fields = withSystemTextFields([BODY]);

    expect(fields.map(field => field.name)).toEqual([
      ...SYSTEM_TEXT_FIELD_NAMES,
      "body",
    ]);
    for (const name of SYSTEM_TEXT_FIELD_NAMES) {
      expect(localizedOf(fields, name)).toBe(false);
    }
    expect(fields).toContain(BODY);
  });

  it.each([undefined, true, false])(
    "leave a declared title and slug as declared (localized: %s)",
    localized => {
      const declared = SYSTEM_TEXT_FIELD_NAMES.map(name => ({
        name,
        type: "text",
        ...(localized === undefined ? {} : { localized }),
      }));

      expect(withSystemTextFields([...declared, BODY])).toEqual([
        ...declared,
        BODY,
      ]);
    }
  );

  it("add the one that is not declared, and leave the other", () => {
    const title = { name: "title", type: "text", localized: true };
    const fields = withSystemTextFields([title]);

    expect(localizedOf(fields, "title")).toBe(true);
    expect(localizedOf(fields, "slug")).toBe(false);
  });
});
