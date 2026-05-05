// Why: lock the description write path to field.admin.description so the
// Builder UI matches the renderer (FieldWrapper reads admin?.description),
// the persistence transformer (field-transformers.ts:428 reads
// admin.description), and the code-first convention. Regression coverage
// for the bug where descriptions written via the Builder were silently
// dropped during save because the Builder wrote to the top-level
// field.description while every other consumer read from admin.description.
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import type { BuilderField } from "../../types";
import { GeneralTab } from "../GeneralTab";

const baseField: BuilderField = {
  id: "f-desc",
  name: "summary",
  label: "Summary",
  type: "text",
  isSystem: false,
  validation: {},
  admin: { width: "100%" },
};

function Controlled(props: {
  initial: BuilderField;
  onChange?: (next: BuilderField) => void;
}) {
  const [field, setField] = useState<BuilderField>(props.initial);
  return (
    <GeneralTab
      field={field}
      siblingNames={[]}
      onChange={next => {
        setField(next);
        props.onChange?.(next);
      }}
    />
  );
}

describe("GeneralTab description write path", () => {
  it("writes description to field.admin.description (not top-level field.description)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={baseField} onChange={onChange} />);

    const desc = screen.getByLabelText(/^description$/i);
    await user.type(desc, "Used in lists and SEO");

    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.admin?.description).toBe("Used in lists and SEO");
    // Top-level description must NOT be set as a side-effect.
    expect(last.description).toBeUndefined();
  });

  it("preserves existing admin properties when writing description", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const seeded: BuilderField = {
      ...baseField,
      admin: { width: "50%", placeholder: "Type a summary..." },
    };
    render(<Controlled initial={seeded} onChange={onChange} />);

    const desc = screen.getByLabelText(/^description$/i);
    await user.type(desc, "Hint text");

    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.admin?.description).toBe("Hint text");
    expect(last.admin?.width).toBe("50%");
    expect(last.admin?.placeholder).toBe("Type a summary...");
  });

  it("loads existing field.admin.description into the input", () => {
    const seeded: BuilderField = {
      ...baseField,
      admin: { width: "100%", description: "Existing hint" },
    };
    render(<Controlled initial={seeded} />);

    const desc = screen.getByLabelText(/^description$/i) as HTMLTextAreaElement;
    expect(desc.value).toBe("Existing hint");
  });

  it("ignores legacy top-level field.description (canonical path is admin.description)", () => {
    // Why: any pre-fix Builder state that wrote to top-level field.description
    // is dead data anyway -- the persistence transformer never read it. The
    // input should reflect admin.description even if a stale top-level value
    // exists (e.g., loaded from local builder state that pre-dates the fix).
    const seeded: BuilderField = {
      ...baseField,
      // Why: BuilderField type still has a legacy top-level description slot.
      // The renderer should read from admin.description (the canonical path).
      description: "Stale top-level value",
      admin: { width: "100%", description: "Canonical value" },
    };
    render(<Controlled initial={seeded} />);

    const desc = screen.getByLabelText(/^description$/i) as HTMLTextAreaElement;
    expect(desc.value).toBe("Canonical value");
  });
});
