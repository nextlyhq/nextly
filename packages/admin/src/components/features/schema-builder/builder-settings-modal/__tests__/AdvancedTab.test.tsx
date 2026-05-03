// Why: AdvancedTab is config-driven (only fields in advancedFields
// render), the i18n switch is always disabled with a "Coming Soon" chip
// until i18n ships, and the status switch toggles the Draft/Published
// flag. PR B: timestamps + useAsTitle removed (always emit / system title
// always wins); new "Show system fields" toggle persists to localStorage.
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import type { BuilderSettingsValues } from "../../BuilderSettingsModal";
import type { AdvancedField } from "../../builder-config";
import { AdvancedTab } from "../AdvancedTab";

function Controlled(props: {
  fields: readonly AdvancedField[];
  initial?: Partial<BuilderSettingsValues>;
  onChange?: (next: BuilderSettingsValues) => void;
}) {
  const [values, setValues] = useState<BuilderSettingsValues>({
    singularName: "Post",
    pluralName: "Posts",
    slug: "posts",
    description: "",
    icon: "FileText",
    status: false,
    i18n: false,
    ...props.initial,
  });
  return (
    <AdvancedTab
      fields={props.fields}
      values={values}
      onChange={next => {
        setValues(next);
        props.onChange?.(next);
      }}
    />
  );
}

describe("AdvancedTab", () => {
  it("renders only the fields listed in the per-kind config", () => {
    render(<Controlled fields={["adminGroup", "order"]} />);
    expect(screen.getByLabelText(/admin group/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/order in sidebar/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: /status/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });

  it("renders i18n as a disabled switch with a Coming Soon chip", () => {
    render(<Controlled fields={["i18n"]} />);
    const sw = screen.getByRole("switch", { name: /internationalization/i });
    expect(sw).toBeDisabled();
    expect(screen.getByText("Coming Soon")).toBeInTheDocument();
  });

  it("toggles status when the status switch is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled fields={["status"]} onChange={onChange} />);
    await user.click(screen.getByRole("switch", { name: /status/i }));
    const last = onChange.mock.lastCall?.[0] as BuilderSettingsValues;
    expect(last.status).toBe(true);
  });

  it("emits adminGroup and order changes through onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled fields={["adminGroup", "order"]} onChange={onChange} />);
    await user.type(screen.getByLabelText(/admin group/i), "Content");
    await user.clear(screen.getByLabelText(/order in sidebar/i));
    await user.type(screen.getByLabelText(/order in sidebar/i), "5");
    const last = onChange.mock.lastCall?.[0] as BuilderSettingsValues;
    expect(last.adminGroup).toBe("Content");
    expect(last.order).toBe(5);
  });
});

describe("AdvancedTab -- showSystemFields", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the system-fields toggle when included", () => {
    render(<Controlled fields={["showSystemFields"]} />);
    expect(screen.getByLabelText("Show system fields")).toBeInTheDocument();
  });

  it("defaults to ON when no prior localStorage value exists", () => {
    render(<Controlled fields={["showSystemFields"]} />);
    const sw = screen.getByLabelText("Show system fields");
    expect(sw.getAttribute("data-state")).toBe("checked");
  });

  it("persists toggle state to localStorage when flipped off", async () => {
    const user = userEvent.setup();
    render(<Controlled fields={["showSystemFields"]} />);
    const sw = screen.getByLabelText("Show system fields");
    await user.click(sw);
    expect(localStorage.getItem("builder.showSystemInternals")).toBe("false");
  });

  it("respects an existing localStorage = 'false' on initial render", () => {
    localStorage.setItem("builder.showSystemInternals", "false");
    render(<Controlled fields={["showSystemFields"]} />);
    const sw = screen.getByLabelText("Show system fields");
    expect(sw.getAttribute("data-state")).toBe("unchecked");
  });
});
