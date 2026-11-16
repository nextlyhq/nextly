// A password or virtual field is never translated, and the server refuses `localized: true` on
// one. A legacy definition may still carry the flag, which the Localized switch shows as OFF and
// does not let the author change; saving it back must not send the refused flag.
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "@admin/types/collection";

import {
  convertToBuilderField,
  convertToFieldDefinition,
} from "./field-transformers";

const roundTrip = (definition: Record<string, unknown>) =>
  convertToFieldDefinition(
    convertToBuilderField(definition as unknown as FieldDefinition, 0)
  );

describe("convertToFieldDefinition — a field that is never translated", () => {
  it("drops a legacy localized flag from a password field", () => {
    const saved = roundTrip({
      name: "secret",
      label: "Secret",
      type: "password",
      localized: true,
    });

    expect(saved.localized).toBeUndefined();
  });

  it("still forwards a translatable field's own choice", () => {
    const saved = roundTrip({
      name: "body",
      label: "Body",
      type: "text",
      localized: false,
    });

    expect(saved.localized).toBe(false);
  });
});
