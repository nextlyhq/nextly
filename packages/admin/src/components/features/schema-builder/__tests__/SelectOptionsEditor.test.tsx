// Why: PR E3 added Select-only knobs (Clearable, Placeholder) and a
// Radio-only knob (Layout). Lock the wire-up so future drift is
// caught.
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { SelectOptionsEditor } from "../SelectOptionsEditor";

describe("SelectOptionsEditor -- PR E3 admin knobs", () => {
  describe("select fieldType", () => {
    it("renders the Clearable switch and reports onIsClearableChange", async () => {
      const user = userEvent.setup();
      const onIsClearableChange = vi.fn();
      render(
        <SelectOptionsEditor
          options={[]}
          onOptionsChange={vi.fn()}
          fieldType="select"
          isClearable={true}
          onIsClearableChange={onIsClearableChange}
          onPlaceholderChange={vi.fn()}
        />
      );
      const sw = screen.getByRole("switch", { name: /clearable/i });
      expect(sw).toBeChecked();
      await user.click(sw);
      expect(onIsClearableChange).toHaveBeenCalledWith(false);
    });

    it("renders the Placeholder input with the current value", () => {
      render(
        <SelectOptionsEditor
          options={[]}
          onOptionsChange={vi.fn()}
          fieldType="select"
          onIsClearableChange={vi.fn()}
          placeholder="Pick one"
          onPlaceholderChange={vi.fn()}
        />
      );
      const input = screen.getByPlaceholderText(/Choose a category/i);
      expect(input).toHaveValue("Pick one");
    });

    it("fires onPlaceholderChange when the input changes", async () => {
      const user = userEvent.setup();
      const onPlaceholderChange = vi.fn();
      render(
        <SelectOptionsEditor
          options={[]}
          onOptionsChange={vi.fn()}
          fieldType="select"
          onIsClearableChange={vi.fn()}
          onPlaceholderChange={onPlaceholderChange}
        />
      );
      const input = screen.getByPlaceholderText(/Choose a category/i);
      // Why: input is React-controlled by `placeholder` prop, but the
      // test parent doesn't echo back. Typing "X" still fires onChange
      // with the new DOM value -- assert the onChange was called at
      // least once with a non-empty string rather than chasing the
      // exact DOM state across re-renders.
      await user.type(input, "X");
      expect(onPlaceholderChange).toHaveBeenCalled();
      const lastCall = onPlaceholderChange.mock.lastCall?.[0] as
        | string
        | undefined;
      expect(lastCall).toMatch(/X/);
    });

    it("does NOT render the Layout control on select fieldType", () => {
      render(
        <SelectOptionsEditor
          options={[]}
          onOptionsChange={vi.fn()}
          fieldType="select"
          onIsClearableChange={vi.fn()}
          onPlaceholderChange={vi.fn()}
        />
      );
      expect(
        screen.queryByRole("button", { name: /^horizontal$/i })
      ).toBeNull();
      expect(screen.queryByRole("button", { name: /^vertical$/i })).toBeNull();
    });
  });

  describe("radio fieldType", () => {
    it("renders the Layout segmented control and reports onLayoutChange", async () => {
      const user = userEvent.setup();
      const onLayoutChange = vi.fn();
      render(
        <SelectOptionsEditor
          options={[]}
          onOptionsChange={vi.fn()}
          fieldType="radio"
          layout="horizontal"
          onLayoutChange={onLayoutChange}
        />
      );
      await user.click(screen.getByRole("button", { name: /^vertical$/i }));
      expect(onLayoutChange).toHaveBeenCalledWith("vertical");
    });

    it("does NOT render Clearable / Placeholder on radio fieldType", () => {
      render(
        <SelectOptionsEditor
          options={[]}
          onOptionsChange={vi.fn()}
          fieldType="radio"
          onLayoutChange={vi.fn()}
        />
      );
      expect(screen.queryByRole("switch", { name: /clearable/i })).toBeNull();
      expect(screen.queryByPlaceholderText(/Choose a category/i)).toBeNull();
    });
  });
});

describe("SelectOptionsEditor -- empty state (PR E4)", () => {
  it("renders the quiet inline helper when options is empty", () => {
    render(
      <SelectOptionsEditor
        options={[]}
        onOptionsChange={vi.fn()}
        fieldType="select"
        onIsClearableChange={vi.fn()}
        onPlaceholderChange={vi.fn()}
      />
    );
    expect(screen.getByText(/no options yet/i)).toBeInTheDocument();
    // Helper mentions both affordances (Add and Import) by name so the
    // user knows where to click without us repeating the buttons.
    expect(screen.getByText(/add or import above/i)).toBeInTheDocument();
  });

  it("does NOT render the loud 'Add first option' button anymore", () => {
    render(
      <SelectOptionsEditor
        options={[]}
        onOptionsChange={vi.fn()}
        fieldType="select"
        onIsClearableChange={vi.fn()}
        onPlaceholderChange={vi.fn()}
      />
    );
    expect(
      screen.queryByRole("button", { name: /add first option/i })
    ).toBeNull();
  });

  it("hides the empty-state helper as soon as options exist", () => {
    render(
      <SelectOptionsEditor
        options={[{ id: "opt_1", label: "Draft", value: "draft" }]}
        onOptionsChange={vi.fn()}
        fieldType="select"
        onIsClearableChange={vi.fn()}
        onPlaceholderChange={vi.fn()}
      />
    );
    expect(screen.queryByText(/no options yet/i)).toBeNull();
  });
});

describe("SelectOptionsEditor -- Import modal Tabs (PR E4)", () => {
  async function openImportModal() {
    const user = userEvent.setup();
    const utils = render(
      <SelectOptionsEditor
        options={[]}
        onOptionsChange={vi.fn()}
        fieldType="select"
        onIsClearableChange={vi.fn()}
        onPlaceholderChange={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: /^import$/i }));
    return { user, ...utils };
  }

  it("renders CSV and JSON tabs in the Import modal", async () => {
    await openImportModal();
    expect(screen.getByRole("tab", { name: /^csv$/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^json$/i })).toBeInTheDocument();
  });

  it("defaults to the CSV tab", async () => {
    await openImportModal();
    expect(screen.getByRole("tab", { name: /^csv$/i })).toHaveAttribute(
      "data-state",
      "active"
    );
  });

  it("switches to the JSON tab when clicked", async () => {
    const { user } = await openImportModal();
    await user.click(screen.getByRole("tab", { name: /^json$/i }));
    expect(screen.getByRole("tab", { name: /^json$/i })).toHaveAttribute(
      "data-state",
      "active"
    );
  });

  it("shows a single-line CSV helper instead of a multi-line code panel", async () => {
    await openImportModal();
    // The new helper is a short sentence, not a <pre> block.
    expect(screen.getByText(/one line per option/i)).toBeInTheDocument();
    // The old loud "CSV Format:" header should be gone.
    expect(screen.queryByText(/^CSV Format:$/)).toBeNull();
  });

  it("shows the JSON helper after switching to the JSON tab", async () => {
    const { user } = await openImportModal();
    await user.click(screen.getByRole("tab", { name: /^json$/i }));
    // Why: the helper text wraps `{label, value}` in a <code> tag, so
    // getByText with a regex spanning text+code+text can't match across
    // the element boundary. Match the leading text node only -- "Array
    // of" is unique to the JSON tab (CSV uses "One line per option").
    expect(screen.getByText(/array of/i)).toBeInTheDocument();
  });
});
