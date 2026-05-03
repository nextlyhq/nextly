// Why: AdvancedTab handles three flags — unique, index, localized
// (placeholder until i18n ships). Tests lock toggle propagation and the
// disabled+badge state for localized.
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

  it("toggles index through onChange.advanced.index", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={f} onChange={onChange} />);
    await user.click(screen.getByRole("switch", { name: /^index$/i }));
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.advanced?.index).toBe(true);
  });

  it("renders Localized as a disabled switch with a Soon badge", () => {
    render(<Controlled initial={f} />);
    const sw = screen.getByRole("switch", { name: /^localized$/i });
    expect(sw).toBeDisabled();
    expect(screen.getByText(/soon/i)).toBeInTheDocument();
  });

  it("disables every editable switch in readOnly mode", () => {
    render(<Controlled initial={f} readOnly />);
    expect(screen.getByRole("switch", { name: /^unique$/i })).toBeDisabled();
    expect(screen.getByRole("switch", { name: /^index$/i })).toBeDisabled();
  });
});
