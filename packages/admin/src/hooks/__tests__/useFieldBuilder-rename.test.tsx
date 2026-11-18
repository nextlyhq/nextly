/**
 * A field's name changed in the settings panel carries the conditions that read it: every
 * condition on its level naming the old name names the new one, in the same edit and the same
 * undo step. This is the road an unsaved field's name takes as it is typed or follows its label.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { useFieldBuilder } from "../useFieldBuilder";

const text = (name: string, extra: Partial<BuilderField> = {}) =>
  ({
    id: `f-${name}`,
    name,
    label: name,
    type: "text",
    ...extra,
  }) as BuilderField;

const gated = (name: string, source: string) =>
  text(name, {
    admin: { condition: { field: source, operator: "isNotEmpty" } },
  });

function setup(fields: BuilderField[]) {
  return renderHook(() =>
    useFieldBuilder({
      resolver: async values => ({ values, errors: {} }),
      defaultValues: {},
      initialFields: fields,
    })
  );
}

const conditionOf = (fields: readonly BuilderField[], id: string) =>
  fields.find(field => field.id === id)?.admin?.condition?.field;

describe("a field's name changed in the settings panel", () => {
  it("carries the conditions that read it, in one undo step", () => {
    const { result } = setup([text("summary"), gated("teaser", "summary")]);

    act(() => {
      result.current.handleFieldUpdate({
        ...text("summary"),
        name: "abstract",
      });
    });
    expect(conditionOf(result.current.fields, "f-teaser")).toBe("abstract");

    act(() => {
      result.current.undo();
    });
    expect(result.current.fields.map(field => field.name)).toEqual([
      "summary",
      "teaser",
    ]);
    expect(conditionOf(result.current.fields, "f-teaser")).toBe("summary");
  });

  it("leaves conditions alone for an edit that keeps the name", () => {
    const { result } = setup([text("summary"), gated("teaser", "summary")]);

    act(() => {
      result.current.handleFieldUpdate({
        ...text("summary"),
        label: "Abstract",
      });
    });
    expect(conditionOf(result.current.fields, "f-teaser")).toBe("summary");
  });
});
