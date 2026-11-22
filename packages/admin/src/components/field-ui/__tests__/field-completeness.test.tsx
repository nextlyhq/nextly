/**
 * A field lacking what its type needs is an error the save refuses, marked on the field's row and
 * in its settings panel: a link with no collection to link to, a dropdown or radio with no
 * options, an option with no label or no value, two options with one value, a group or repeater
 * with nothing in it, a field group field with no field group chosen. What the save accepts is no
 * error: an upload, which always links to the media library, needs no collection.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FieldErrorNotice } from "@admin/components/features/schema-builder/FieldErrorNotice";
import type { BuilderField } from "@admin/components/features/schema-builder/types";
import { convertToBuilderField } from "@admin/lib/builder/field-transformers";
import { builderFieldErrors } from "@admin/lib/builder/field-validators";

const field = (overrides: Partial<BuilderField>): BuilderField => ({
  id: "f1",
  name: "subject",
  label: "Subject",
  type: "text",
  validation: {},
  ...overrides,
});

/** The error the save would refuse `subject` with, or undefined. */
const errorOf = (overrides: Partial<BuilderField>) =>
  builderFieldErrors([field(overrides)]).get("f1");

const option = (label: string, value: string) => ({ label, value });

describe("a field lacking what its type needs", () => {
  it.each([
    [
      "a link with no collection",
      { type: "relationship" },
      /"subject" must link to a collection/,
    ],
    [
      "a link with an empty list of collections",
      { type: "relationship", relationTo: [] },
      /"subject" must link to a collection/,
    ],
    ["a dropdown with no options", { type: "select", options: [] }, /option/],
    ["a radio with no options", { type: "radio" }, /option/],
    [
      "an option with no value",
      { type: "select", options: [option("A", "")] },
      /"subject" has an option with no value/,
    ],
    [
      "an option with no label",
      { type: "radio", options: [option("", "a")] },
      /"subject" has an option with no label/,
    ],
    [
      "two options with one value",
      { type: "select", options: [option("A", "a"), option("B", "a")] },
      /"subject" has two options with the value "a"/,
    ],
    [
      "a repeater with nothing in it",
      { type: "repeater", fields: [] },
      /"subject" must hold at least one field/,
    ],
    [
      "a group with nothing in it",
      { type: "group", fields: [] },
      /"subject" must hold at least one field/,
    ],
    [
      "a field group field with none chosen",
      { type: "component" },
      /"subject" must have a field group selected/,
    ],
  ] as const)("is an error: %s", (_case, overrides, message) => {
    expect(errorOf(overrides as Partial<BuilderField>)?.message).toMatch(
      message
    );
  });

  it.each([
    ["a link to a collection", { type: "relationship", relationTo: "posts" }],
    ["an upload, which links to the media library", { type: "upload" }],
    [
      "options each with a label and a value of their own",
      { type: "select", options: [option("A", "a"), option("B", "b")] },
    ],
    [
      "options whose values differ only in letter case",
      { type: "radio", options: [option("A", "a"), option("B", "A")] },
    ],
    [
      "a repeater with a field in it",
      { type: "repeater", fields: [field({ id: "f2", name: "item" })] },
    ],
  ] as const)("is no error: %s", (_case, overrides) => {
    expect(errorOf(overrides as Partial<BuilderField>)).toBeUndefined();
  });
});

// A relationship stored the earlier way names its collection in `options.target` and, for a
// many-to-many, is handed to the Builder without `relationTo`: it links somewhere, as the save
// accepts, and loading it does not make it an error.
describe("a relationship stored the earlier way", () => {
  const loaded = (options: Record<string, unknown>) =>
    convertToBuilderField(
      {
        name: "subject",
        type: "relationship",
        options,
      } as unknown as Parameters<typeof convertToBuilderField>[0],
      0
    );

  it("is no error with its stored target", () => {
    const relationship = loaded({
      target: "tags",
      relationType: "manyToMany",
    });
    expect(builderFieldErrors([relationship]).get(relationship.id)).toBe(
      undefined
    );
  });

  it("is an error with no target stored", () => {
    const relationship = loaded({ relationType: "manyToMany" });
    expect(builderFieldErrors([relationship]).get(relationship.id)?.kind).toBe(
      "no-target"
    );
  });
});

// Only a group or a repeater holds nested fields, as the save judges them: a plugin type may keep
// a `fields` option of its own as private configuration.
describe("fields nested in a field", () => {
  const repeated = field({
    id: "f2",
    name: "kind",
    type: "select",
    options: [option("A", "a"), option("B", "a")],
  });

  it("are judged inside a group", () => {
    const errors = builderFieldErrors([
      field({ type: "group", fields: [repeated] }),
    ]);
    expect(errors.get("f2")?.kind).toBe("bad-option");
  });

  it("are not judged inside another type's own `fields` setting", () => {
    const errors = builderFieldErrors([
      field({
        type: "acme-picker" as BuilderField["type"],
        fields: [repeated],
      }),
    ]);
    expect(errors.has("f2")).toBe(false);
  });
});

describe("the field's settings panel", () => {
  it("says what the field lacks", () => {
    const fields = [field({ type: "relationship" })];

    render(<FieldErrorNotice fields={fields} fieldId="f1" />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /"subject" must link to a collection/
    );
  });

  it("says nothing for a field with no error", () => {
    const fields = [field({ type: "relationship", relationTo: "posts" })];

    render(<FieldErrorNotice fields={fields} fieldId="f1" />);

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
