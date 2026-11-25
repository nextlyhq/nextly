/**
 * One field being translated: the source it shows, the control it is written
 * in, and the language each is marked with.
 */
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@admin/__tests__/utils";

import type { TranslationField } from "../translation-fields";
import {
  TranslationFieldRow,
  type FieldRowState,
  type TranslationFieldRowProps,
} from "../TranslationFieldRow";

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins: [] }),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));

const SPANISH = { code: "es", label: "Spanish", rtl: false };
const ARABIC = { code: "ar", label: "Arabic", rtl: true };
const ENGLISH = { code: "en", label: "English", rtl: false };
const LABELS: Record<string, string> = {
  en: "English",
  es: "Spanish",
  ar: "Arabic",
};

const BIO: TranslationField = {
  field: {
    name: "bio",
    type: "textarea",
    label: "Biography",
  } as unknown as TranslationField["field"],
  name: "bio",
  label: "Biography",
};

const onSourceChange = vi.fn();

const ROW: TranslationFieldRowProps = {
  translated: BIO,
  target: SPANISH,
  source: { language: ENGLISH, value: "A pioneer", eligible: ["en"] },
  labelOf: code => LABELS[code] ?? code,
  onSourceChange,
  outOfDate: false,
  readOnly: false,
};

function Harness({
  row,
  values,
}: {
  row: TranslationFieldRowProps;
  values: Record<string, unknown>;
}) {
  const form = useForm<Record<string, unknown>>({ defaultValues: values });
  return (
    <FormProvider {...form}>
      <TranslationFieldRow {...row} />
    </FormProvider>
  );
}

function renderRow(
  over: Partial<TranslationFieldRowProps> = {},
  values: Record<string, unknown> = { bio: "Una pionera" }
) {
  return renderWithProviders(
    <Harness row={{ ...ROW, ...over }} values={values} />
  );
}

const row = () => screen.getByRole("group", { name: "Biography" });
const slot = (name: string) =>
  row().querySelector<HTMLElement>(`[data-slot="${name}"]`);
const control = () => screen.getByRole("textbox", { name: "Biography" });

beforeEach(() => {
  onSourceChange.mockReset();
});

describe("TranslationFieldRow", () => {
  it("shows the source first, in its own language, and writes the target", () => {
    renderRow();
    const source = slot("translation-source");
    const target = slot("translation-target");
    expect(source).not.toBeNull();
    expect(target).not.toBeNull();
    // First in the document, so a narrow screen stacks it above.
    expect(
      source!.compareDocumentPosition(target!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      within(source!).getByText("A pioneer").closest("[lang]")
    ).toHaveAttribute("lang", "en");
    expect(control()).toHaveValue("Una pionera");
  });

  it("marks the control with the language written, and not its label", () => {
    renderRow({ target: ARABIC });
    expect(control()).toHaveAttribute("lang", "ar");
    expect(control()).toHaveAttribute("dir", "rtl");
    const label = within(row()).getByText("Biography", { selector: "label" });
    expect(label.closest("[lang]")).toBeNull();
    expect(label.closest('[dir="rtl"]')).toBeNull();
  });

  it("marks a control that appears after the field did", async () => {
    renderRow({ target: ARABIC });
    const late = document.createElement("div");
    late.setAttribute("contenteditable", "false");
    await act(async () => {
      control().parentElement?.append(late);
      // A control nobody can write in yet is not marked.
      await Promise.resolve();
      late.setAttribute("contenteditable", "true");
      await Promise.resolve();
    });
    expect(late).toHaveAttribute("lang", "ar");
    expect(late).toHaveAttribute("dir", "rtl");
  });

  it("writes a source's direction on its value", () => {
    renderRow({
      source: { language: ARABIC, value: "رائدة", eligible: ["ar"] },
    });
    const value = within(slot("translation-source")!)
      .getByText("رائدة")
      .closest("[dir]");
    expect(value).toHaveAttribute("dir", "rtl");
    expect(value).toHaveAttribute("lang", "ar");
  });

  describe("the source picker", () => {
    it("names the one language a field can be translated from", () => {
      renderRow();
      expect(
        within(slot("translation-source")!).getByText("English")
      ).toBeInTheDocument();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });

    it("offers the others a field can be translated from", async () => {
      const user = userEvent.setup();
      renderRow({
        target: ARABIC,
        source: {
          language: ENGLISH,
          value: "A pioneer",
          eligible: ["en", "es"],
        },
      });
      await user.click(
        screen.getByRole("combobox", {
          name: "Source language for Biography",
        })
      );
      expect(
        screen.getAllByRole("option").map(option => option.textContent)
      ).toEqual(["English", "Spanish"]);
      await user.click(screen.getByRole("option", { name: "Spanish" }));
      expect(onSourceChange).toHaveBeenCalledExactlyOnceWith("es");
    });
  });

  it("writes a field with no source as original content", async () => {
    const user = userEvent.setup();
    renderRow({ source: undefined }, { bio: "" });
    expect(slot("translation-source")).toBeNull();
    expect(
      screen.getByText(/written here as original Spanish/)
    ).toBeInTheDocument();
    await user.type(control(), "Hola");
    expect(control()).toHaveValue("Hola");
  });

  it("says when the source changed since", () => {
    const { unmount } = renderRow({ outOfDate: true });
    expect(screen.getByText("out of date")).toBeInTheDocument();
    unmount();
    renderRow();
    expect(screen.queryByText("out of date")).not.toBeInTheDocument();
  });

  it("cannot be written in by a reader who may only look", async () => {
    const user = userEvent.setup();
    renderRow({ readOnly: true });
    await user.type(control(), "!");
    expect(control()).toHaveValue("Una pionera");
  });

  describe("a field shown only while another holds a value", () => {
    const conditional: TranslationField = {
      ...BIO,
      field: {
        ...BIO.field,
        admin: { condition: { field: "kind", equals: "person" } },
      } as unknown as TranslationField["field"],
    };

    it("is left out with its source, as the form leaves it out", () => {
      const { unmount } = renderRow(
        { translated: conditional },
        { bio: "Una pionera", kind: "company" }
      );
      expect(
        screen.queryByRole("group", { name: "Biography" })
      ).not.toBeInTheDocument();
      unmount();
      renderRow(
        { translated: conditional },
        { bio: "Una pionera", kind: "person" }
      );
      expect(row()).toBeInTheDocument();
    });
  });

  describe("a suggestion", () => {
    const choices = { onUse: vi.fn(), onEdit: vi.fn(), onDismiss: vi.fn() };
    const suggestion = { value: "Una precursora" };

    it("is nothing where there is none", () => {
      renderRow({ suggestionChoices: choices });
      expect(
        screen.queryByRole("group", { name: "Suggestion for Biography" })
      ).not.toBeInTheDocument();
    });

    it("offers its choices and leaves the field alone", () => {
      renderRow({ suggestion, suggestionChoices: choices });
      const block = screen.getByRole("group", {
        name: "Suggestion for Biography",
      });
      expect(within(block).getByText("Una precursora")).toBeInTheDocument();
      expect(within(block).getAllByRole("button")).toHaveLength(3);
      expect(control()).toHaveValue("Una pionera");
    });

    it("offers none to a reader who may only look", () => {
      renderRow({ suggestion, suggestionChoices: choices, readOnly: true });
      const block = screen.getByRole("group", {
        name: "Suggestion for Biography",
      });
      expect(within(block).getByText("Una precursora")).toBeInTheDocument();
      expect(within(block).queryByRole("button")).not.toBeInTheDocument();
    });
  });
});

describe("what is drawn under an out-of-date field", () => {
  const review = vi.fn(
    ({ readOnly, focusField }: FieldRowState): ReactNode => (
      <button type="button" onClick={focusField}>
        {readOnly ? "Look" : "Review"}
      </button>
    )
  );

  it("stands under the field, and takes the keyboard to its control", async () => {
    renderRow({ outOfDate: true, review });
    const button = screen.getByRole("button", { name: "Review" });
    expect(
      control().compareDocumentPosition(button) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    await userEvent.click(button);
    expect(control()).toHaveFocus();
  });

  it("is told of a field that may only be looked at", () => {
    renderRow({ outOfDate: true, readOnly: true, review });
    expect(screen.getByRole("button", { name: "Look" })).toBeInTheDocument();
  });

  it("is not drawn under a field that is up to date", () => {
    renderRow({ review });
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
  });
});
