// Why: AdvancedTab is config-driven (only fields in advancedFields
// render), the i18n switch is always disabled with a "Coming Soon" chip
// until i18n ships, and the status switch toggles the Draft/Published
// union and the per-kind configs; the type system blocks them being
// passed as fields, so negative-render assertions are unnecessary.
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
    render(<Controlled fields={["status"]} />);
    expect(screen.getByRole("switch", { name: /status/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: /internationalization/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });

  it("toggles i18n when the Internationalization switch is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled fields={["i18n"]} onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: /internationalization/i });
    expect(sw).not.toBeDisabled();
    await user.click(sw);
    const last = onChange.mock.lastCall?.[0] as BuilderSettingsValues;
    expect(last.i18n).toBe(true);
  });

  it("toggles status when the status switch is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled fields={["status"]} onChange={onChange} />);
    await user.click(screen.getByRole("switch", { name: /status/i }));
    const last = onChange.mock.lastCall?.[0] as BuilderSettingsValues;
    expect(last.status).toBe(true);
  });

  it("renders status switch in the checked state when values.status is true", () => {
    render(<Controlled fields={["status"]} initial={{ status: true }} />);
    const sw = screen.getByRole("switch", { name: /status/i });
    expect(sw.getAttribute("data-state")).toBe("checked");
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
