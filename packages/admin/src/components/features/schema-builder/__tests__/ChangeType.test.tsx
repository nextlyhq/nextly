/**
 * Change type… in the Schema Builder: the picker opened on a field, each type marked as the change
 * would go. A field not saved yet may become any type, keeping what fits the new one; a saved
 * field may become what the server says its saved values allow, each refusal in the save's own
 * words; a group holding fields becomes only repeating rows.
 */
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act, render, screen, waitFor } from "@admin/__tests__/utils";
import { useFieldBuilder } from "@admin/hooks/useFieldBuilder";
import { COLLECTION_BUILDER_CONFIG } from "@admin/pages/dashboard/collections/builder/builder-config";
import type { TypeChangeTarget } from "@admin/services/schemaApi";

import { BuilderChangeType } from "../BuilderChangeType";
import { BuilderOverlays, type ActiveOverlay } from "../BuilderOverlays";
import type { BuilderField, BuilderFieldsApi } from "../types";

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins: [] }),
}));

vi.mock("@admin/hooks/queries", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/queries")>()),
  useFieldGroups: () => ({ data: { items: [] }, isLoading: false }),
}));

/** The server's answer, and each path it was asked about. */
let answer: () => Promise<TypeChangeTarget[]> = async () => [];
const asked: Array<{ address: string; path: readonly string[] }> = [];
vi.mock("@admin/services/schemaApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/schemaApi")>()),
  typeChangeTargetsAt: (address: string, path: readonly string[]) => {
    asked.push({ address, path });
    return answer();
  },
}));

afterEach(() => {
  answer = async () => [];
  asked.length = 0;
});

const kind: BuilderField = {
  id: "f-kind",
  name: "kind",
  label: "Kind",
  type: "select",
  options: [{ label: "A", value: "a" }],
  hasMany: true,
  validation: { required: true },
};
const meta: BuilderField = {
  id: "f-meta",
  name: "meta",
  label: "Meta",
  type: "group",
  fields: [
    { id: "f-rating", name: "rating", label: "Rating", type: "number" },
    { id: "f-note", name: "note", label: "Note", type: "text" },
  ],
};

/** The row of one type, by the id the picker marks it with. */
const row = (type: string) =>
  document.querySelector(`[role="option"][data-type="${type}"]`) as HTMLElement;

function renderChange(fieldId: string, savedFields?: BuilderField[]) {
  const onChanged = vi.fn();
  const user = userEvent.setup();
  render(
    <BuilderChangeType
      config={COLLECTION_BUILDER_CONFIG}
      fields={[kind, meta]}
      fieldId={fieldId}
      entitySlug="posts"
      savedFields={savedFields}
      onCancel={vi.fn()}
      onChanged={onChanged}
    />
  );
  return { user, onChanged };
}

describe("Change type… on a field not saved yet", () => {
  it("offers every other type, asks the server nothing, and keeps what fits the new type", async () => {
    const { user, onChanged } = renderChange("f-kind");
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Change the type of Kind"
    );
    expect(row("select")).toBeNull();
    expect(row("number")).not.toHaveAttribute("aria-disabled");
    await user.click(row("number"));
    expect(asked).toEqual([]);
    // A number has no options and no several picks; Required and the label stay.
    expect(onChanged).toHaveBeenCalledWith({
      id: "f-kind",
      name: "kind",
      label: "Kind",
      type: "number",
      validation: { required: true },
    });
  });

  it("a group holding fields becomes only repeating rows, which keeps them", async () => {
    const { user, onChanged } = renderChange("f-meta");
    expect(row("text")).toHaveAttribute("aria-disabled", "true");
    expect(row("text")).toHaveTextContent(
      "It holds 2 fields, which only a group or repeating rows keeps."
    );
    await user.click(row("repeater"));
    expect(onChanged).toHaveBeenCalledWith(
      expect.objectContaining({ type: "repeater", fields: meta.fields })
    );
  });
});

describe("Change type… on a saved field", () => {
  it("asks the server by the field's saved path, and shows each answer: a mark, or the save's own reason", async () => {
    answer = async () => [
      { type: "text", blocked: null, refusal: null, outcome: "converts" },
      { type: "checkbox", blocked: null, refusal: null, outcome: "may-lose" },
      {
        type: "textarea",
        blocked: "leaves-translation",
        refusal: {
          code: "RESHAPED_FIELD_LEAVES_TRANSLATION",
          reason: "Its type changes as it stops being translated.",
          steps: ["Turn off Localized and save."],
        },
        outcome: null,
      },
      { type: "date", blocked: "never-held", refusal: null, outcome: null },
    ];
    const savedRating = { ...meta.fields![0] };
    const { user, onChanged } = renderChange("f-rating", [
      kind,
      { ...meta, fields: [savedRating, meta.fields![1]] },
    ]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking what each type does to the saved values…"
    );
    await waitFor(() =>
      expect(row("text")).toHaveTextContent("Converts the values")
    );
    expect(asked).toEqual([
      { address: "/collections/schema/posts", path: ["meta", "rating"] },
    ]);
    expect(row("checkbox")).toHaveTextContent("May lose some values");
    expect(row("textarea")).toHaveTextContent(
      "Unavailable: Its type changes as it stops being translated. Turn off Localized and save."
    );
    expect(row("date")).toHaveTextContent(
      "Unavailable: No value it holds could be kept as this type."
    );
    // A type the server did not judge cannot be picked either.
    expect(row("email")).toHaveAttribute("aria-disabled", "true");
    await user.click(row("textarea"));
    expect(onChanged).not.toHaveBeenCalled();
    await user.click(row("text"));
    expect(onChanged).toHaveBeenCalledWith(
      expect.objectContaining({ id: "f-rating", type: "text" })
    );
  });

  it("changed already, it offers its type as saved back, as keeping every value", async () => {
    answer = async () => [];
    const { user, onChanged } = renderChange("f-kind", [
      { ...kind, type: "radio" },
      meta,
    ]);
    await waitFor(() =>
      expect(row("radio")).toHaveTextContent("Keeps every value")
    );
    await user.click(row("radio"));
    expect(onChanged).toHaveBeenCalledWith(
      expect.objectContaining({ type: "radio", options: kind.options })
    );
  });

  it("says so when the server cannot be asked, and offers nothing meanwhile", async () => {
    answer = async () => {
      throw new TypeError("Failed to fetch");
    };
    renderChange("f-kind", [kind, meta]);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "What each type would do to the saved values could not be checked (Failed to fetch). Close and try again."
      )
    );
    expect(row("number")).toHaveAttribute("aria-disabled", "true");
  });
});

describe("Change type… through the Builder's overlay", () => {
  /** The Builder's own draft and history, with the overlay opened on `kind`. */
  function Harness({ seen }: { seen: { builder?: BuilderFieldsApi } }) {
    const builder = useFieldBuilder({
      resolver: async values => ({ values, errors: {} }),
      defaultValues: {},
      initialFields: [kind],
    });
    seen.builder = builder;
    const [active, setActive] = useState<ActiveOverlay>({
      kind: "change-type",
      fieldId: "f-kind",
    });
    return (
      <BuilderOverlays
        active={active}
        onActiveChange={setActive}
        config={COLLECTION_BUILDER_CONFIG}
        builder={builder}
        settings={{ singularName: "Post", slug: "posts", icon: "Database" }}
        onSettingsChange={() => {}}
        readOnly={false}
      />
    );
  }

  it("is one undo step of its own: undone, the dropdown has every setting back", async () => {
    const seen: { builder?: BuilderFieldsApi } = {};
    const user = userEvent.setup();
    render(<Harness seen={seen} />);
    await user.click(row("number"));
    expect(seen.builder?.fields[0]).toMatchObject({ type: "number" });
    expect(seen.builder?.fields[0]).not.toHaveProperty("options");
    // An edit of the field's settings after it is a step of its own too.
    act(() => {
      seen.builder?.handleFieldUpdate({
        ...(seen.builder?.fields[0] as BuilderField),
        label: "Kind of post",
      });
    });
    act(() => {
      seen.builder?.undo();
    });
    expect(seen.builder?.fields[0]).toMatchObject({
      type: "number",
      label: "Kind",
    });
    act(() => {
      seen.builder?.undo();
    });
    expect(seen.builder?.fields[0]).toEqual(kind);
  });
});
