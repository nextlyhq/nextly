// Why: AdminTab controls how a field renders in the record editor — width
// (segmented 25/33/50/66/75/100), position (main/sidebar), readOnly, hidden,
// and a JSON-textarea conditional-visibility editor. Tests lock width
// changes and the readOnly disabling.
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import type { BuilderField } from "../../types";
import { AdminTab } from "../AdminTab";

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
    <AdminTab
      field={field}
      readOnly={props.readOnly}
      onChange={next => {
        setField(next);
        props.onChange?.(next);
      }}
    />
  );
}

describe("AdminTab", () => {
  it("renders the segmented width control with all six options", () => {
    render(<Controlled initial={f} />);
    for (const w of ["25%", "33%", "50%", "66%", "75%", "100%"]) {
      expect(screen.getByRole("button", { name: w })).toBeInTheDocument();
    }
  });

  it("changes width when a segment is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={f} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "50%" }));
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.admin?.width).toBe("50%");
  });

  it("toggles readOnly via the switch", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={f} onChange={onChange} />);
    await user.click(screen.getByRole("switch", { name: /^read only$/i }));
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.admin?.readOnly).toBe(true);
  });

  it("toggles hidden via the switch", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={f} onChange={onChange} />);
    await user.click(screen.getByRole("switch", { name: /^hidden$/i }));
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.admin?.hidden).toBe(true);
  });

  it("disables every input in readOnly mode", () => {
    render(<Controlled initial={f} readOnly />);
    for (const w of ["25%", "33%", "50%", "66%", "75%", "100%"]) {
      expect(screen.getByRole("button", { name: w })).toBeDisabled();
    }
    expect(screen.getByRole("switch", { name: /^read only$/i })).toBeDisabled();
    expect(screen.getByRole("switch", { name: /^hidden$/i })).toBeDisabled();
  });
});
