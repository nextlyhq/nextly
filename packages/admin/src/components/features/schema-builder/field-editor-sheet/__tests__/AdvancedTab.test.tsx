// Why: AdvancedTab handles two flags after PR E1 -- unique and
// localized (placeholder until i18n ships). Index toggle was dropped
// in PR E1 (auto-indexing is a future backend concern). Localized
// badge styling switched from amber "Soon" to neutral "Coming Soon"
// chip per feedback Section 4.
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import type { BuilderField } from "../../types";
import { AdvancedTab } from "../AdvancedTab";

const f: BuilderField = {
  id: "f1",
  name: "x",
  label: "X",
  type: "text",
  isSystem: false,
  validation: {},
  admin: { width: "100%" },
};

function Controlled(props: {
  initial: BuilderField;
  readOnly?: boolean;
  onChange?: (next: BuilderField) => void;
}) {
  const [field, setField] = useState<BuilderField>(props.initial);
  return (
    <AdvancedTab
      field={field}
      readOnly={props.readOnly}
      onChange={next => {
        setField(next);
        props.onChange?.(next);
      }}
    />
  );
}

describe("FieldEditorSheet — AdvancedTab", () => {
  it("toggles unique through onChange.advanced.unique", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={f} onChange={onChange} />);
    await user.click(screen.getByRole("switch", { name: /^unique$/i }));
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.advanced?.unique).toBe(true);
  });

  it("does NOT render the Index switch (removed in PR E1)", () => {
    render(<Controlled initial={f} />);
    expect(
      screen.queryByRole("switch", { name: /^index$/i })
    ).not.toBeInTheDocument();
  });

  it("renders Localized as a disabled switch with a 'Coming Soon' chip", () => {
    render(<Controlled initial={f} />);
    const sw = screen.getByRole("switch", { name: /^localized$/i });
    expect(sw).toBeDisabled();
    expect(screen.getByText("Coming Soon")).toBeInTheDocument();
  });

  it("disables every editable switch in readOnly mode", () => {
    render(<Controlled initial={f} readOnly />);
    expect(screen.getByRole("switch", { name: /^unique$/i })).toBeDisabled();
  });
});

describe("AdvancedTab -- unique disabled when nested (PR E3)", () => {
  it("does not disable unique when isInsideRepeatingAncestor is omitted", () => {
    render(<Controlled initial={f} />);
    expect(
      screen.getByRole("switch", { name: /^unique$/i })
    ).not.toBeDisabled();
  });

  it("greys out the unique switch and shows tooltip when isInsideRepeatingAncestor is true", () => {
    render(
      <AdvancedTab field={f} isInsideRepeatingAncestor onChange={vi.fn()} />
    );
    expect(screen.getByRole("switch", { name: /^unique$/i })).toBeDisabled();
    expect(
      screen.getByText(
        /unique can't be enforced inside a repeater or repeatable component/i
      )
    ).toBeInTheDocument();
  });

  it("readOnly takes precedence over isInsideRepeatingAncestor (both disable)", () => {
    render(
      <AdvancedTab
        field={f}
        readOnly
        isInsideRepeatingAncestor
        onChange={vi.fn()}
      />
    );
    expect(screen.getByRole("switch", { name: /^unique$/i })).toBeDisabled();
  });
});
