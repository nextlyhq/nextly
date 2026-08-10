// Why: AdvancedTab is config-driven (only fields in advancedFields
// render), the i18n switch is gated on the app's `localization` config
// (surfaced via BrandingProvider's admin-meta), and the status switch
// toggles the Draft/Published union and the per-kind configs; the type
// system blocks them being passed as fields, so negative-render
// assertions are unnecessary.
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient, render, screen } from "@admin/__tests__/utils";
import { BrandingProvider } from "@admin/context/providers/BrandingProvider";

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

/**
 * Render with a BrandingProvider whose admin-meta query is pre-seeded with a
 * localization config, so `useLocalization()` reports configured locales —
 * the state in which the Internationalization switch is interactive.
 */
function renderWithLocales(ui: React.ReactElement) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(["admin-meta"], {
    locales: {
      defaultLocale: "en",
      fallback: true,
      locales: [
        { code: "en", label: "English", rtl: false, fallbackLocale: [] },
        { code: "de", label: "German", rtl: false, fallbackLocale: ["en"] },
      ],
    },
  });
  return render(<BrandingProvider>{ui}</BrandingProvider>, { queryClient });
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

  it("toggles i18n when localization is configured", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithLocales(<Controlled fields={["i18n"]} onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: /internationalization/i });
    expect(sw).not.toBeDisabled();
    await user.click(sw);
    const last = onChange.mock.lastCall?.[0] as BuilderSettingsValues;
    expect(last.i18n).toBe(true);
  });

  it("disables the i18n switch with instructions when the app has no localization config", () => {
    // No BrandingProvider/admin-meta → useLocalization reports zero locales.
    render(<Controlled fields={["i18n"]} />);
    const sw = screen.getByRole("switch", { name: /internationalization/i });
    expect(sw).toBeDisabled();
    expect(screen.getByText(/not configured/i)).toBeInTheDocument();
    expect(
      screen.getByText(/requires a `localization` block/i)
    ).toBeInTheDocument();
  });

  it("keeps the i18n switch interactive for an already-localized entity", () => {
    // Disabling must stay possible even when the config block was removed:
    // locking the switch would trap the entity in the localized state.
    render(<Controlled fields={["i18n"]} initial={{ i18n: true }} />);
    const sw = screen.getByRole("switch", { name: /internationalization/i });
    expect(sw).not.toBeDisabled();
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

  it("keeps the prior cap when the field is cleared and restores it on blur", async () => {
    // Clearing mid-edit must not drop the committed cap (to the default or 0);
    // it stays until a valid replacement is typed, and blur restores the field.
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
    await user.tab(); // blur

    // Clearing never committed a change away from the prior cap...
    const committed = onChange.mock.calls.map(
      c => (c[0] as BuilderSettingsValues).versionsMaxPerDoc
    );
    expect(committed).not.toContain(undefined);
    // ...and the field is restored to the committed value, still on screen.
    expect(input).toHaveValue(20);
  });

  it("keeps the saved cap and restores the field when invalid text is entered", async () => {
    // An invalid entry (fractional/negative) is never committed, and on blur the
    // field snaps back to the committed value so a save can't persist a cap
    // different from what is shown.
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
    await user.type(input, "20.5");
    await user.tab(); // blur

    const last = onChange.mock.lastCall?.[0] as
      | BuilderSettingsValues
      | undefined;
    // The invalid value was never committed, so the cap is still the last valid
    // one (or unchanged), and the field shows that value, not "20.5".
    expect(last?.versionsMaxPerDoc).not.toBe(20.5);
    expect(input).toHaveValue(20);
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
