/**
 * Whether a restore may change a field is the form's own decision: the field's
 * gates folded over the nameless containers around it, as the form passes a
 * container's gates down to its fields.
 */
import type { FieldConfig } from "nextly/config";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";

import { renderHook } from "@admin/__tests__/utils";

import {
  useEditorRestoreSurface,
  useFormRestore,
} from "../useEditorRestoreSurface";

const fields = [
  {
    type: "row",
    admin: { readOnly: true },
    fields: [{ name: "title", type: "text" }],
  },
  { name: "body", type: "text" },
] as unknown as FieldConfig[];

function useSurface() {
  const form = useForm<Record<string, unknown>>({
    defaultValues: { title: "Now", body: "B" },
  });
  const restore = useFormRestore(form);
  return useEditorRestoreSurface({
    restore,
    form,
    fields,
    readOnly: () => false,
    localized: false,
  });
}

describe("useEditorRestoreSurface", () => {
  it("does not let a restore change a field inside a read-only container", () => {
    const { result } = renderHook(() => useSurface());

    expect(result.current.canEdit("title")).toBe(false);
    expect(result.current.canEdit("body")).toBe(true);
  });
});
