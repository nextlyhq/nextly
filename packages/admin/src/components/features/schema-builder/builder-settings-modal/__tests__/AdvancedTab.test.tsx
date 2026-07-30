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

describe("AdvancedTab -- version history", () => {
  it("renders nothing when the kind does not enable it", () => {
    render(<Controlled fields={["status"]} />);
    expect(
      screen.queryByRole("switch", { name: /version history/i })
    ).not.toBeInTheDocument();
  });

  it("toggles versions when the switch is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled fields={["versions"]} onChange={onChange} />);
    await user.click(screen.getByRole("switch", { name: /version history/i }));
    const last = onChange.mock.lastCall?.[0] as BuilderSettingsValues;
    expect(last.versions).toBe(true);
  });

  it("renders checked when versioning is already on", () => {
    render(<Controlled fields={["versions"]} initial={{ versions: true }} />);
    const sw = screen.getByRole("switch", { name: /version history/i });
    expect(sw.getAttribute("data-state")).toBe("checked");
  });

  it("says what it does not do, so nobody reads it as drafts", () => {
    render(<Controlled fields={["versions"]} />);
    expect(screen.getByText(/does not add drafts/i)).toBeInTheDocument();
  });

  it("shows the retention count only for a custom cap", () => {
    // A stored number is the "keep last N" mode, so the count field is visible.
    render(
      <Controlled
        fields={["versions"]}
        initial={{ versions: true, versionsMaxPerDoc: 20 }}
      />
    );
    expect(
      screen.getByRole("spinbutton", { name: /versions to keep per document/i })
    ).toHaveValue(20);
  });

  it("commits the default when a custom retention count is cleared", async () => {
    // Clearing the field must not leave the previous number persisted on save;
    // it commits undefined (the default) while the input stays visible.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Controlled
        fields={["versions"]}
        initial={{ versions: true, versionsMaxPerDoc: 20 }}
        onChange={onChange}
      />
    );
    const input = screen.getByRole("spinbutton", {
      name: /versions to keep per document/i,
    });
    await user.clear(input);
    const last = onChange.mock.lastCall?.[0] as BuilderSettingsValues;
    expect(last.versionsMaxPerDoc).toBeUndefined();
    // The field is still on screen so a replacement can be typed.
    expect(input).toBeInTheDocument();
  });

  it("does not show a retention count when versioning is off", () => {
    render(<Controlled fields={["versions"]} initial={{ versions: false }} />);
    expect(
      screen.queryByRole("spinbutton", {
        name: /versions to keep per document/i,
      })
    ).not.toBeInTheDocument();
  });
});

describe("AdvancedTab -- cache revalidation", () => {
  it("renders nothing when the kind does not enable it", () => {
    render(<Controlled fields={["status"]} />);
    expect(
      screen.queryByRole("switch", { name: /cache revalidation/i })
    ).not.toBeInTheDocument();
  });

  it("renders checked by default because revalidation is on", () => {
    // Unlike version history, an absent value means ON — the switch must show
    // checked so the user is not misled into thinking caching is off.
    render(<Controlled fields={["revalidate"]} />);
    const sw = screen.getByRole("switch", { name: /cache revalidation/i });
    expect(sw.getAttribute("data-state")).toBe("checked");
  });

  it("sets revalidate to false when toggled off", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled fields={["revalidate"]} onChange={onChange} />);
    await user.click(
      screen.getByRole("switch", { name: /cache revalidation/i })
    );
    const last = onChange.mock.lastCall?.[0] as BuilderSettingsValues;
    expect(last.revalidate).toBe(false);
  });

  it("renders unchecked when revalidation was turned off", () => {
    render(
      <Controlled fields={["revalidate"]} initial={{ revalidate: false }} />
    );
    const sw = screen.getByRole("switch", { name: /cache revalidation/i });
    expect(sw.getAttribute("data-state")).toBe("unchecked");
  });
});

describe("AdvancedTab -- webhook recording", () => {
  it("renders nothing when the kind does not enable it", () => {
    render(<Controlled fields={["status"]} />);
    expect(
      screen.queryByRole("switch", { name: /webhook recording/i })
    ).not.toBeInTheDocument();
  });

  it("renders checked by default because recording is on", () => {
    // Like revalidation, an absent value means ON. Showing it unchecked would
    // tell an operator their content is already being kept out of the outbox
    // when it is in fact being delivered.
    render(<Controlled fields={["webhooks"]} />);
    const sw = screen.getByRole("switch", { name: /webhook recording/i });
    expect(sw.getAttribute("data-state")).toBe("checked");
  });

  it("sets webhooks to false when toggled off", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled fields={["webhooks"]} onChange={onChange} />);
    await user.click(
      screen.getByRole("switch", { name: /webhook recording/i })
    );
    const last = onChange.mock.lastCall?.[0] as BuilderSettingsValues;
    expect(last.webhooks).toBe(false);
  });

  it("renders unchecked when webhook recording was turned off", () => {
    render(<Controlled fields={["webhooks"]} initial={{ webhooks: false }} />);
    const sw = screen.getByRole("switch", { name: /webhook recording/i });
    expect(sw.getAttribute("data-state")).toBe("unchecked");
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
