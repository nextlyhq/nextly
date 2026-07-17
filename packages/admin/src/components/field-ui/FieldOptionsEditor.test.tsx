import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  FieldOptionsEditor,
  withOptionIds,
  type FieldOption,
} from "./FieldOptionsEditor";

const optionsOf = (...pairs: [string, string][]): FieldOption[] =>
  pairs.map(([label, value], index) => ({
    id: `id_${index}`,
    label,
    value,
  }));

describe("FieldOptionsEditor", () => {
  it("renders a label + value row per option", () => {
    render(
      <FieldOptionsEditor
        options={optionsOf(["Draft", "draft"], ["Published", "published"])}
        onOptionsChange={() => {}}
      />
    );
    expect(screen.getByDisplayValue("Draft")).toBeInTheDocument();
    expect(screen.getByDisplayValue("published")).toBeInTheDocument();
  });

  it("adds an empty option", () => {
    const onOptionsChange = vi.fn();
    render(
      <FieldOptionsEditor
        options={optionsOf(["Draft", "draft"])}
        onOptionsChange={onOptionsChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    const next = onOptionsChange.mock.calls[0][0] as FieldOption[];
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({ label: "", value: "" });
  });

  it("auto-derives the value from the label while it still tracks the label", () => {
    const onOptionsChange = vi.fn();
    render(
      <FieldOptionsEditor
        options={optionsOf(["", ""])}
        onOptionsChange={onOptionsChange}
      />
    );
    fireEvent.change(screen.getByLabelText("Option label"), {
      target: { value: "In Review" },
    });
    const next = onOptionsChange.mock.calls[0][0] as FieldOption[];
    // Slug-with-underscores, so the stored value is a safe identifier.
    expect(next[0]).toMatchObject({ label: "In Review", value: "in_review" });
  });

  it("leaves a hand-edited value alone when the label later changes", () => {
    const onOptionsChange = vi.fn();
    const options = optionsOf(["Draft", "custom_value"]);
    render(
      <FieldOptionsEditor options={options} onOptionsChange={onOptionsChange} />
    );
    fireEvent.change(screen.getByLabelText("Option label"), {
      target: { value: "Draft Two" },
    });
    const next = onOptionsChange.mock.calls[0][0] as FieldOption[];
    expect(next[0]).toMatchObject({
      label: "Draft Two",
      value: "custom_value",
    });
  });

  it("removes an option", () => {
    const onOptionsChange = vi.fn();
    render(
      <FieldOptionsEditor
        options={optionsOf(["Draft", "draft"], ["Published", "published"])}
        onOptionsChange={onOptionsChange}
      />
    );
    const removeButtons = screen.getAllByRole("button", {
      name: /remove option/i,
    });
    fireEvent.click(removeButtons[0]);
    const next = onOptionsChange.mock.calls[0][0] as FieldOption[];
    expect(next).toHaveLength(1);
    expect(next[0].value).toBe("published");
  });

  it("reports every duplicate stored value as a group", () => {
    render(
      <FieldOptionsEditor
        options={optionsOf(
          ["A", "same"],
          ["B", "same"],
          ["C", "other"],
          ["D", "other"]
        )}
        onOptionsChange={() => {}}
      />
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(`"same"`);
    expect(alert).toHaveTextContent(`"other"`);
  });

  it("shows an empty state and no duplicate alert when there are no options", () => {
    render(<FieldOptionsEditor options={[]} onOptionsChange={() => {}} />);
    expect(screen.getByText(/no options yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("hides the import affordance when allowImport is false", () => {
    render(
      <FieldOptionsEditor
        options={[]}
        onOptionsChange={() => {}}
        allowImport={false}
      />
    );
    expect(
      screen.queryByRole("button", { name: /import/i })
    ).not.toBeInTheDocument();
  });

  it("imports CSV rows, auto-generating missing values, and appends them", () => {
    const onOptionsChange = vi.fn();
    render(
      <FieldOptionsEditor
        options={optionsOf(["Existing", "existing"])}
        onOptionsChange={onOptionsChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /import/i }));
    fireEvent.change(screen.getByLabelText("CSV options"), {
      target: { value: "Draft,draft\nArchived" },
    });
    fireEvent.click(screen.getByRole("button", { name: /import options/i }));
    const next = onOptionsChange.mock.calls[0][0] as FieldOption[];
    expect(next).toHaveLength(3);
    expect(next[1]).toMatchObject({ label: "Draft", value: "draft" });
    expect(next[2]).toMatchObject({ label: "Archived", value: "archived" });
  });

  it("imports a JSON array of objects and appends them", async () => {
    const user = userEvent.setup();
    const onOptionsChange = vi.fn();
    render(
      <FieldOptionsEditor options={[]} onOptionsChange={onOptionsChange} />
    );
    await user.click(screen.getByRole("button", { name: /^import$/i }));
    await user.click(screen.getByRole("tab", { name: /^json$/i }));
    fireEvent.change(screen.getByLabelText("JSON options"), {
      target: { value: `[{"label":"Draft","value":"draft"},"Archived"]` },
    });
    await user.click(screen.getByRole("button", { name: /import options/i }));
    const next = onOptionsChange.mock.calls[0][0] as FieldOption[];
    expect(next[0]).toMatchObject({ label: "Draft", value: "draft" });
    expect(next[1]).toMatchObject({ label: "Archived", value: "archived" });
  });

  it("surfaces a readable error for malformed JSON import", async () => {
    const user = userEvent.setup();
    render(<FieldOptionsEditor options={[]} onOptionsChange={() => {}} />);
    await user.click(screen.getByRole("button", { name: /^import$/i }));
    await user.click(screen.getByRole("tab", { name: /^json$/i }));
    fireEvent.change(screen.getByLabelText("JSON options"), {
      target: { value: "{ not an array }" },
    });
    await user.click(screen.getByRole("button", { name: /import options/i }));
    expect(screen.getByText(/invalid json format/i)).toBeInTheDocument();
  });

  it("rejects malformed JSON option objects instead of importing blank rows", async () => {
    const user = userEvent.setup();
    const onOptionsChange = vi.fn();
    render(
      <FieldOptionsEditor options={[]} onOptionsChange={onOptionsChange} />
    );
    await user.click(screen.getByRole("button", { name: /^import$/i }));
    await user.click(screen.getByRole("tab", { name: /^json$/i }));
    fireEvent.change(screen.getByLabelText("JSON options"), {
      target: { value: `[{}]` },
    });
    await user.click(screen.getByRole("button", { name: /import options/i }));
    expect(screen.getByText(/non-empty string label/i)).toBeInTheDocument();
    expect(onOptionsChange).not.toHaveBeenCalled();
  });

  it("surfaces an error when a JSON empty array yields no options", async () => {
    const user = userEvent.setup();
    render(<FieldOptionsEditor options={[]} onOptionsChange={() => {}} />);
    await user.click(screen.getByRole("button", { name: /^import$/i }));
    await user.click(screen.getByRole("tab", { name: /^json$/i }));
    fireEvent.change(screen.getByLabelText("JSON options"), {
      target: { value: "[]" },
    });
    await user.click(screen.getByRole("button", { name: /import options/i }));
    expect(screen.getByText(/no options found/i)).toBeInTheDocument();
  });

  it("disables the editing affordances in read-only mode", () => {
    render(
      <FieldOptionsEditor
        options={optionsOf(["Draft", "draft"])}
        onOptionsChange={() => {}}
        disabled
      />
    );
    expect(screen.getByRole("button", { name: /^add$/i })).toBeDisabled();
    expect(screen.getByLabelText("Option label")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /remove option/i })
    ).toBeDisabled();
  });
});

describe("withOptionIds", () => {
  it("seeds stable ids onto plain label/value pairs", () => {
    const seeded = withOptionIds([
      { label: "Draft", value: "draft" },
      { label: "Published", value: "published" },
    ]);
    expect(seeded).toHaveLength(2);
    expect(seeded[0]).toMatchObject({ label: "Draft", value: "draft" });
    expect(seeded[0].id).toBeTruthy();
    expect(seeded[0].id).not.toBe(seeded[1].id);
  });

  it("honors a custom id prefix so two mounted editors cannot collide", () => {
    const a = withOptionIds([{ label: "X", value: "x" }], "left");
    const b = withOptionIds([{ label: "X", value: "x" }], "right");
    expect(a[0].id.startsWith("left")).toBe(true);
    expect(b[0].id.startsWith("right")).toBe(true);
  });
});

// Guards against a copy/paste regression in the sortable row: editing the
// second row's value must not touch the first row.
describe("FieldOptionsEditor row wiring", () => {
  it("edits the value of the correct row", () => {
    const onOptionsChange = vi.fn();
    render(
      <FieldOptionsEditor
        options={optionsOf(["First", "first"], ["Second", "second"])}
        onOptionsChange={onOptionsChange}
      />
    );
    const valueInputs = screen.getAllByLabelText("Option value");
    fireEvent.change(valueInputs[1], { target: { value: "changed" } });
    const next = onOptionsChange.mock.calls[0][0] as FieldOption[];
    expect(next[1].value).toBe("changed");
    expect(next[0].value).toBe("first");
  });
});
