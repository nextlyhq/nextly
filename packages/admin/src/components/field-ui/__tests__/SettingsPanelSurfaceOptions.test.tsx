// Why: the settings panel's per-surface options, each against the default
// surface as its control, so a test that passed because the option did
// nothing (the rule, the switch or the editor simply absent everywhere) would
// show it. The Form Builder and user custom fields configure the panel this
// way; the Schema Builder sets none of these and must see no change.
import userEvent from "@testing-library/user-event";
import { useState, type JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { BuilderField } from "@admin/components/features/schema-builder/types";
import { toSnakeName } from "@admin/lib/builder";

import {
  FieldSettingsPanel,
  type FieldSettingsConditionsProps,
  type FieldSettingsSurface,
} from "../settings-panel";

// The plugin list a test sets; none by default.
const branding = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
afterEach(() => {
  branding.current = {};
});

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => branding.current,
  // The plugin list still pending: a type the panel does not know as built in
  // would read "Loading", which is what the surface-only types used to do.
  useBrandingStatus: () => ({
    isPending: true,
    isUnavailable: false,
    retry: () => {},
    isBrandingUnavailable: false,
  }),
}));

const entries: FieldSettingsSurface = {
  surface: "entries",
  deriveName: toSnakeName,
  conditions: "sibling",
};

function field(type: string, over: Partial<BuilderField> = {}): BuilderField {
  return {
    id: `f-${type}`,
    name: "subject",
    label: "Subject",
    type,
    validation: {},
    ...over,
  };
}

const SIBLING = field("text", { id: "f-other", name: "other", label: "Other" });

function Host({
  initial,
  surface,
}: {
  initial: BuilderField;
  surface: FieldSettingsSurface;
}): JSX.Element {
  const [current, setCurrent] = useState(initial);
  return (
    <FieldSettingsPanel
      surface={surface}
      field={current}
      ancestors={[]}
      siblings={[current, SIBLING]}
      saved={false}
      onChange={setCurrent}
    />
  );
}

async function openTab(name: string) {
  await userEvent.setup().click(screen.getByRole("tab", { name }));
}

describe("a surface's validation rules", () => {
  it("offers only the rules the surface keeps", async () => {
    render(
      <Host
        initial={field("text")}
        surface={{ ...entries, validationRules: () => ["maxLength"] }}
      />
    );
    await openTab("Validation");
    expect(screen.getByText("Max length")).toBeInTheDocument();
    expect(screen.queryByText("Min length")).toBeNull();
  });

  it("never offers a rule the type cannot hold, whatever the surface returns", async () => {
    render(
      <Host
        initial={field("text")}
        surface={{ ...entries, validationRules: () => ["min", "maxLength"] }}
      />
    );
    await openTab("Validation");
    expect(screen.getByText("Max length")).toBeInTheDocument();
    expect(screen.queryByText("Min")).toBeNull();
  });

  it("offers every rule core allows on a surface that narrows none", async () => {
    render(<Host initial={field("text")} surface={entries} />);
    await openTab("Validation");
    expect(screen.getByText("Min length")).toBeInTheDocument();
    expect(screen.getByText("Max length")).toBeInTheDocument();
  });
});

describe("a surface's own conditions editor", () => {
  function OwnConditions({ siblings }: FieldSettingsConditionsProps) {
    return <p>Own editor beside {siblings.map(s => s.label).join(", ")}</p>;
  }

  it("draws the surface's editor as the whole tab, given the siblings", async () => {
    render(
      <Host
        initial={field("text")}
        surface={{ ...entries, conditions: OwnConditions }}
      />
    );
    await openTab("Conditions");
    expect(screen.getByText("Own editor beside Other")).toBeInTheDocument();
    expect(screen.queryByText(/show this field only when/i)).toBeNull();
    expect(screen.queryByText(/always shown/i)).toBeNull();
  });

  it("keeps the shared condition builder on a surface without one", async () => {
    render(<Host initial={field("text")} surface={entries} />);
    await openTab("Conditions");
    expect(screen.getByText(/show this field only when/i)).toBeInTheDocument();
  });
});

describe("the Display switches", () => {
  it("hides Read only and Hidden where the surface says they mean nothing", async () => {
    render(
      <Host
        initial={field("text")}
        surface={{ ...entries, displaySwitches: false }}
      />
    );
    await openTab("Display");
    expect(screen.queryByRole("switch", { name: "Read only" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Hidden" })).toBeNull();
    // The rest of the tab is still there.
    expect(screen.getByLabelText("Placeholder")).toBeInTheDocument();
  });

  it("shows them by default", async () => {
    render(<Host initial={field("text")} surface={entries} />);
    await openTab("Display");
    expect(
      screen.getByRole("switch", { name: "Read only" })
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Hidden" })).toBeInTheDocument();
  });
});

describe("the Width setting", () => {
  it("is left out where the surface stores no width", () => {
    render(
      <Host
        initial={field("text")}
        surface={{ ...entries, widthSetting: false }}
      />
    );
    expect(screen.queryByRole("radiogroup", { name: "Width" })).toBeNull();
    // The rest of General is still there.
    expect(screen.getByRole("textbox", { name: "Label" })).toBeInTheDocument();
  });

  it("is offered by default", () => {
    render(<Host initial={field("text")} surface={entries} />);
    expect(
      screen.getByRole("radiogroup", { name: "Width" })
    ).toBeInTheDocument();
  });
});

describe("a surface's own type settings", () => {
  it("draws them in place of the core table's", () => {
    const yesNo = () => <p>One yes or no</p>;
    render(
      <Host
        initial={field("checkbox")}
        surface={{
          ...entries,
          typeSettings: { checkbox: { defining: yesNo } },
        }}
      />
    );
    expect(screen.getByText("One yes or no")).toBeInTheDocument();
    // The core checkbox settings are a list of choices.
    expect(screen.queryByText(/allow multiple/i)).toBeNull();
  });

  it("never reads an inherited member as a type the surface set", () => {
    render(
      <Host
        initial={field("toString")}
        surface={{ ...entries, typeSettings: { checkbox: {} } }}
      />
    );
    // A plugin's type, so it waits for the plugin list like any other.
    expect(screen.getByText(/loading this type/i)).toBeInTheDocument();
  });

  it("leaves the core settings where the surface names none", () => {
    render(
      <Host initial={field("checkbox", { options: [] })} surface={entries} />
    );
    expect(screen.queryByText("One yes or no")).toBeNull();
    expect(screen.getByText(/allow multiple/i)).toBeInTheDocument();
  });
});

describe("the forms and user-fields surfaces' built-in types", () => {
  const forms: FieldSettingsSurface = { ...entries, surface: "forms" };

  it.each([
    ["url", "URL"],
    ["phone", "Phone"],
    ["time", "Time"],
    ["hidden", "Hidden"],
    ["file", "File upload"],
  ])("know %s as built in and name it %s", (type, label) => {
    render(<Host initial={field(type)} surface={forms} />);
    // Known at once, while the plugin list is still pending.
    expect(screen.queryByText(/loading this type/i)).toBeNull();
    expect(screen.queryByText(/could not be loaded/i)).toBeNull();
    // Named by its catalog label, never its raw id.
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" && element.textContent === `Type: ${label}`
      )
    ).toBeInTheDocument();
  });

  it.each([
    ["entries", "url"],
    ["entries", "file"],
    ["users", "file"],
    ["users", "hidden"],
  ] as const)(
    "leave %s's %s to the plugin that declares it",
    (surface, type) => {
      render(<Host initial={field(type)} surface={{ ...entries, surface }} />);
      // Not built in there, so the panel waits for the plugin list.
      expect(screen.getByText(/loading this type/i)).toBeInTheDocument();
    }
  );

  it("know users' url as built in", () => {
    render(
      <Host initial={field("url")} surface={{ ...entries, surface: "users" }} />
    );
    expect(screen.queryByText(/loading this type/i)).toBeNull();
  });
});

describe("a plugin that reuses a surface's built-in id", () => {
  // A plugin's `url`, stored as a number and offered on both surfaces: on
  // forms the built-in URL wins it, on entries the plugin's type is the field.
  const acmeUrl = {
    plugins: [
      {
        name: "acme",
        enabled: true,
        fieldTypes: [
          {
            type: "url",
            component: "acme/Url",
            storage: "number",
            surfaces: ["entries", "forms"],
            label: "Acme URL",
          },
        ],
      },
    ],
  };

  it("keeps the surface's own rules and placeholder where it builds the type in", async () => {
    branding.current = acmeUrl;
    render(
      <Host initial={field("url")} surface={{ ...entries, surface: "forms" }} />
    );
    await openTab("Validation");
    expect(screen.getByLabelText("Pattern")).toBeInTheDocument();
    expect(screen.queryByLabelText("Min", { exact: true })).toBeNull();
    await openTab("Display");
    expect(screen.getByLabelText("Placeholder")).toBeInTheDocument();
  });

  it("follows the plugin's storage and offers no built-in placeholder elsewhere", async () => {
    branding.current = acmeUrl;
    render(<Host initial={field("url")} surface={entries} />);
    await openTab("Validation");
    expect(screen.getByLabelText("Min", { exact: true })).toBeInTheDocument();
    expect(screen.queryByLabelText("Pattern")).toBeNull();
    await openTab("Display");
    expect(screen.queryByLabelText("Placeholder")).toBeNull();
  });
});
