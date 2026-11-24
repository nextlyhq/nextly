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
import {
  convertToBuilderField,
  convertToFieldDefinition,
} from "@admin/lib/builder/field-transformers";
import { COLLECTION_BUILDER_CONFIG } from "@admin/pages/dashboard/collections/builder/builder-config";
import type {
  TypeChangeQuestion,
  TypeChangeTarget,
} from "@admin/services/typeChangeTargetsApi";
import type { FieldDefinition } from "@admin/types/collection";

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

/** The server's answer, and each thing it was asked. */
let answer: () => Promise<TypeChangeTarget[]> = async () => [];
const asked: Array<{ address: string; question: TypeChangeQuestion }> = [];
vi.mock("@admin/services/typeChangeTargetsApi", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/services/typeChangeTargetsApi")
  >()),
  typeChangeTargetsAt: (address: string, question: TypeChangeQuestion) => {
    asked.push({ address, question });
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

describe("Change type… on a new group holding a new field and a saved field moved in", () => {
  const summary: BuilderField = {
    id: "f-summary",
    name: "summary",
    label: "Summary",
    type: "text",
  };
  const fresh: BuilderField = {
    id: "f-fresh",
    name: "fresh",
    label: "Fresh",
    type: "number",
  };
  const holder: BuilderField = {
    id: "f-holder",
    name: "holder",
    label: "Holder",
    type: "group",
    fields: [fresh, summary],
  };
  // The saved field stands on the row; the group is the draft's own, so the server is asked nothing.
  const changeHolder = (holding: BuilderField) => {
    const onChanged = vi.fn();
    const { unmount } = render(
      <BuilderChangeType
        config={COLLECTION_BUILDER_CONFIG}
        fields={[holding]}
        fieldId="f-holder"
        entitySlug="posts"
        savedFields={[summary]}
        onCancel={vi.fn()}
        onChanged={onChanged}
      />
    );
    return { onChanged, unmount };
  };

  it("becomes only the other container, every other type unavailable with how many fields it holds, and keeps them there and back", async () => {
    const user = userEvent.setup();
    const there = changeHolder(holder);
    const rows = [...document.querySelectorAll('[role="option"][data-type]')];
    const open = rows
      .filter(each => each.getAttribute("aria-disabled") !== "true")
      .map(each => each.getAttribute("data-type"));
    expect(open).toEqual(["repeater"]);
    expect(rows.length).toBeGreaterThan(5);
    for (const each of rows.filter(
      r => r.getAttribute("data-type") !== "repeater"
    )) {
      expect(each).toHaveTextContent("It holds 2 fields");
    }
    await user.click(row("repeater"));
    const asRows = there.onChanged.mock.calls[0]?.[0] as BuilderField;
    expect(asRows).toMatchObject({
      type: "repeater",
      fields: [fresh, summary],
    });
    there.unmount();

    const back = changeHolder(asRows);
    await user.click(row("group"));
    expect(back.onChanged.mock.calls[0]?.[0]).toMatchObject({
      type: "group",
      fields: [fresh, summary],
    });
    expect(asked).toEqual([]);
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
    expect(asked.map(each => each.address)).toEqual([
      "/collections/schema/posts",
    ]);
    // The field as saved, its type as saved, and every other type offered.
    const [{ question }] = asked;
    expect(question.path).toEqual(["meta", "rating"]);
    expect(question.type).toBe("number");
    expect(question.candidates.map(each => each.type)).toEqual(
      expect.arrayContaining(["text", "textarea", "checkbox", "select"])
    );
    expect(question.candidates.map(each => each.type)).not.toContain("number");
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

  it("asks of a saved list the several values the change would keep, and of a single one none", async () => {
    answer = async () => [];
    renderChange("f-kind", [kind, meta]);
    await waitFor(() => expect(asked).toHaveLength(1));
    const keeps = (type: string) =>
      asked[0]?.question.candidates.find(each => each.type === type)?.field
        .hasMany === true;
    // The dropdown takes several picks; a text field, changed to from it, holds one.
    expect(keeps("radio")).toBe(false);
    expect(keeps("text")).toBe(false);
  });

  // What the draft holds is what the change would save: its options, dropped or edited, and no
  // others, so the answer is about the field the person would get.
  it("asks of each type over the options the change would leave the field", async () => {
    answer = async () => [];
    const optionsAsked = (type: string) =>
      asked[0]?.question.candidates
        .find(each => each.type === type)
        ?.field.options?.map(option => option.value) ?? [];
    const saved: BuilderField = {
      ...kind,
      options: [
        { label: "A", value: "a" },
        { label: "B", value: "b" },
      ],
    };
    const ask = (draft: BuilderField) => {
      asked.length = 0;
      return render(
        <BuilderChangeType
          config={COLLECTION_BUILDER_CONFIG}
          fields={[draft]}
          fieldId="f-kind"
          entitySlug="posts"
          savedFields={[saved]}
          onCancel={vi.fn()}
          onChanged={vi.fn()}
        />
      );
    };
    // The draft is a text now, its options gone: radio buttons picked from it have none.
    const { unmount } = ask({
      id: "f-kind",
      name: "kind",
      label: "Kind",
      type: "text",
      validation: {},
    });
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(optionsAsked("radio")).toEqual([]);
    unmount();
    // The draft is radio buttons with one option left.
    ask({
      ...saved,
      type: "radio",
      hasMany: undefined,
      options: [{ label: "A", value: "a" }],
    });
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(optionsAsked("checkbox")).toEqual(["a"]);
    expect(optionsAsked("text")).toEqual([]);
  });

  // Unique, Localized and the rules it keeps shape the column the change makes, and the draft may
  // have set any of them since the save.
  it("asks of each type as the save would write the field, with the draft's own settings", async () => {
    answer = async () => [];
    const draft: BuilderField = {
      id: "f-kind",
      name: "kind",
      label: "Kind",
      type: "textarea",
      validation: { maxLength: 40 },
      advanced: { unique: true, index: false, localized: false },
    };
    render(
      <BuilderChangeType
        config={COLLECTION_BUILDER_CONFIG}
        fields={[draft]}
        fieldId="f-kind"
        entitySlug="posts"
        savedFields={[{ ...draft, advanced: undefined, validation: {} }]}
        onCancel={vi.fn()}
        onChanged={vi.fn()}
      />
    );
    await waitFor(() => expect(asked).toHaveLength(1));
    const asText = asked[0]?.question.candidates.find(
      each => each.type === "text"
    );
    expect(asText?.field).toEqual(
      convertToFieldDefinition({ ...draft, type: "text" })
    );
    expect(asText?.field).toMatchObject({
      type: "text",
      unique: true,
      localized: false,
      validation: { maxLength: 40 },
    });
  });

  it("asks by the settings the field was saved with, as it loads one stored with none of them", async () => {
    answer = async () => [];
    const stored = { name: "kind", label: "Kind", type: "text" };
    const saved = convertToBuilderField(stored as FieldDefinition, 0);
    const askedOf = async (draft: BuilderField, savedAs: BuilderField) => {
      asked.length = 0;
      const { unmount } = render(
        <BuilderChangeType
          config={COLLECTION_BUILDER_CONFIG}
          fields={[draft]}
          fieldId={saved.id}
          entitySlug="posts"
          savedFields={[savedAs]}
          onCancel={vi.fn()}
          onChanged={vi.fn()}
        />
      );
      await waitFor(() => expect(asked).toHaveLength(1));
      unmount();
      // As it is sent: what is undefined is not.
      return JSON.parse(JSON.stringify(asked[0]?.question.saved)) as unknown;
    };
    const drafted: BuilderField = {
      ...saved,
      hasMany: true,
      advanced: { unique: true, index: false, localized: false },
    };
    expect(await askedOf(drafted, saved)).toEqual({
      hasMany: false,
      unique: false,
      options: [],
      validation: {},
    });
    expect(
      await askedOf(saved, {
        ...drafted,
        options: [{ label: "A", value: "a" }],
        validation: { required: true, maxLength: 40 },
        // A plugin's own options, under any name, are no rule of the field's.
        pluginOptions: { pattern: "^a", max: 5 },
      })
    ).toEqual({
      hasMany: true,
      unique: true,
      localized: false,
      options: ["a"],
      validation: { required: true, maxLength: 40 },
    });
  });

  it("asks of no rule an ordinary field does not have, whatever the type", async () => {
    answer = async () => [];
    const bare = convertToBuilderField(
      { name: "kind", label: "Kind", type: "text" } as FieldDefinition,
      0
    );
    render(
      <BuilderChangeType
        config={COLLECTION_BUILDER_CONFIG}
        fields={[bare]}
        fieldId={bare.id}
        entitySlug="posts"
        savedFields={[bare]}
        onCancel={vi.fn()}
        onChanged={vi.fn()}
      />
    );
    await waitFor(() => expect(asked).toHaveLength(1));
    const candidates = asked[0]?.question.candidates ?? [];
    expect(candidates.length).toBeGreaterThan(5);
    for (const { type, field } of candidates) {
      expect(field.validation, type).toBeUndefined();
      expect(field.required, type).toBe(false);
      expect(field.unique, type).toBe(false);
    }
  });

  it("asks by the rules a field was saved with, as the Builder has always saved one", async () => {
    answer = async () => [];
    const saved = convertToBuilderField(
      {
        name: "kind",
        label: "Kind",
        type: "text",
        required: true,
        unique: false,
        index: false,
        validation: { maxLength: 40, message: "Too long" },
        admin: { width: "50%" },
      } as FieldDefinition,
      0
    );
    render(
      <BuilderChangeType
        config={COLLECTION_BUILDER_CONFIG}
        fields={[saved]}
        fieldId={saved.id}
        entitySlug="posts"
        savedFields={[saved]}
        onCancel={vi.fn()}
        onChanged={vi.fn()}
      />
    );
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(JSON.parse(JSON.stringify(asked[0]?.question.saved))).toEqual({
      hasMany: false,
      unique: false,
      options: [],
      validation: { required: true, maxLength: 40, message: "Too long" },
    });
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

  // The draft's change dropped what the new type cannot show: coming back brings the saved field's
  // settings back whole, with what the person has edited since.
  it("back to its type as saved, the field has every setting it was saved with", async () => {
    const savedKind: BuilderField = {
      ...kind,
      admin: { placeholder: "Pick one", isClearable: true, width: "50%" },
    };
    // The draft: text, renamed, its options and picks gone.
    const draft: BuilderField = {
      id: "f-kind",
      name: "kind",
      label: "Kind, renamed",
      type: "text",
      validation: { required: false },
      admin: { width: "100%" },
    };
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(
      <BuilderChangeType
        config={COLLECTION_BUILDER_CONFIG}
        fields={[draft]}
        fieldId="f-kind"
        entitySlug="posts"
        savedFields={[savedKind]}
        onCancel={vi.fn()}
        onChanged={onChanged}
      />
    );
    await waitFor(() =>
      expect(row("select")).toHaveTextContent("Keeps every value")
    );
    await user.click(row("select"));
    expect(onChanged).toHaveBeenCalledWith({
      id: "f-kind",
      name: "kind",
      label: "Kind, renamed",
      type: "select",
      options: kind.options,
      hasMany: true,
      // Required and width as the person has them now, the dropdown's own settings as saved.
      validation: { required: false },
      admin: { placeholder: "Pick one", isClearable: true, width: "100%" },
    });
  });

  // Trying again would ask about the same earlier definition: only reloading the page helps.
  it("says to reload, in the server's words alone, when the saved field has changed since", async () => {
    const words =
      "The saved field kind has changed since the page was loaded. Reload it to see the field as saved.";
    answer = async () => {
      throw Object.assign(new Error(words), { status: 409, code: "CONFLICT" });
    };
    renderChange("f-kind", [kind, meta]);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/Reload it/)
    );
    expect(screen.getByRole("status").textContent).toBe(words);
    expect(row("number")).toHaveAttribute("aria-disabled", "true");
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
