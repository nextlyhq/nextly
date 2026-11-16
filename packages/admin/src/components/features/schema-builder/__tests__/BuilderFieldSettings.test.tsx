// Why: the Schema Builder's host for the shared settings panel. It finds the
// field wherever it sits, hands every change to the Builder's draft at once
// (no Apply, no Cancel), lets a name follow its label only until the field has
// been saved, adds the Builder's own Advanced settings, asks before deleting,
// and shows a code-first entity or a plugin's field read-only. The panel's own
// promises are pinned in field-ui/__tests__/SettingsPanel.test.tsx.
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { BuilderFieldSettings } from "../BuilderFieldSettings";
import type { BuilderField } from "../types";

// The installed plugins the panel sees, so a test can contribute a field type
// the way /admin-meta does. Empty by default.
const branding = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => branding.current,
}));

const excerpt: BuilderField = {
  id: "f-1",
  name: "summary",
  label: "Summary",
  type: "textarea",
  isSystem: false,
  validation: {},
  admin: { width: "100%" },
};

const systemTitle: BuilderField = {
  id: "system_title",
  name: "title",
  label: "Title",
  type: "text",
  isSystem: true,
  validation: { required: true },
};

const caption: BuilderField = {
  id: "f-caption",
  name: "caption",
  label: "Caption",
  type: "text",
};

const slides: BuilderField = {
  id: "f-slides",
  name: "slides",
  label: "Slides",
  type: "repeater",
  fields: [caption],
};

/** Holds the fields as the Builder's draft does, recording each update. */
function Builder({
  initial,
  fieldId,
  saved = [],
  readOnly = false,
  onUpdate = () => {},
  onDelete = () => {},
}: {
  initial: BuilderField[];
  fieldId: string;
  saved?: string[];
  readOnly?: boolean;
  onUpdate?: (next: BuilderField) => void;
  onDelete?: (id: string) => void;
}) {
  const [fields, setFields] = useState(initial);
  return (
    <BuilderFieldSettings
      kind="collection"
      fields={fields}
      fieldId={fieldId}
      savedFieldIds={new Set(saved)}
      readOnly={readOnly}
      docked={false}
      onFieldChange={next => {
        onUpdate(next);
        setFields(all => all.map(f => (f.id === next.id ? next : f)));
      }}
      onFieldDelete={onDelete}
      onClose={() => {}}
    />
  );
}

describe("BuilderFieldSettings", () => {
  it("opens on a field nested in repeating rows, with its API path", () => {
    render(<Builder initial={[slides]} fieldId="f-caption" />);
    expect(
      screen.getByRole("heading", { name: "Caption" })
    ).toBeInTheDocument();
    expect(screen.getByText("slides[].caption")).toBeInTheDocument();
  });

  it("renders nothing for a field that is gone", () => {
    const { container } = render(
      <Builder initial={[excerpt]} fieldId="f-missing" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("hands each edit to the Builder at once, with no Apply or Cancel", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<Builder initial={[excerpt]} fieldId="f-1" onUpdate={onUpdate} />);
    expect(
      screen.queryByRole("button", { name: /^(apply|cancel|add field)$/i })
    ).toBeNull();

    await user.click(screen.getByRole("switch", { name: "Required" }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.lastCall?.[0].validation?.required).toBe(true);
  });

  it("keeps a saved field's name when its label changes", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <Builder
        initial={[excerpt]}
        fieldId="f-1"
        saved={["f-1"]}
        onUpdate={onUpdate}
      />
    );
    const label = screen.getByLabelText(/^Label$/);
    await user.clear(label);
    await user.type(label, "Excerpt");
    expect(onUpdate.mock.lastCall?.[0]).toMatchObject({
      label: "Excerpt",
      name: "summary",
    });
  });

  it("lets a field added since the last save follow its label", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <Builder
        initial={[excerpt]}
        fieldId="f-1"
        saved={[]}
        onUpdate={onUpdate}
      />
    );
    const label = screen.getByLabelText(/^Label$/);
    await user.clear(label);
    await user.type(label, "Excerpt");
    expect(onUpdate.mock.lastCall?.[0]).toMatchObject({
      label: "Excerpt",
      name: "excerpt",
    });
  });

  it("asks before deleting, and deletes only once confirmed", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<Builder initial={[excerpt]} fieldId="f-1" onDelete={onDelete} />);

    await user.click(screen.getByRole("button", { name: /delete field/i }));
    const confirm = within(screen.getByRole("alertdialog"));
    expect(confirm.getByText(/summary/i)).toBeInTheDocument();
    await user.click(confirm.getByRole("button", { name: /cancel/i }));
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /delete field/i }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: /delete field/i,
      })
    );
    expect(onDelete).toHaveBeenCalledWith("f-1");
  });

  it("offers no delete for a system field", () => {
    render(<Builder initial={[systemTitle]} fieldId="system_title" />);
    expect(screen.queryByRole("button", { name: /delete field/i })).toBeNull();
    expect(screen.getByLabelText(/^Name$/)).toBeDisabled();
  });

  it("shows a code-first entity's field read-only, with no delete", () => {
    render(<Builder initial={[excerpt]} fieldId="f-1" readOnly />);
    expect(screen.getByLabelText(/^Label$/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: /delete field/i })).toBeNull();
  });

  it("shows a plugin's locked field read-only", () => {
    render(
      <Builder
        initial={[{ ...excerpt, source: "plugin", owner: "seo", locked: true }]}
        fieldId="f-1"
      />
    );
    expect(screen.getByLabelText(/^Label$/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: /delete field/i })).toBeNull();
  });

  it("adds Unique and Localized to Advanced, Unique held inside repeating rows", async () => {
    const user = userEvent.setup();
    render(<Builder initial={[slides]} fieldId="f-caption" />);
    await user.click(screen.getByRole("tab", { name: "Advanced" }));
    expect(screen.getByRole("switch", { name: "Unique" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Localized" })).toBeEnabled();
  });

  it("leaves Unique open at the top level", async () => {
    const user = userEvent.setup();
    render(<Builder initial={[excerpt]} fieldId="f-1" />);
    await user.click(screen.getByRole("tab", { name: "Advanced" }));
    expect(screen.getByRole("switch", { name: "Unique" })).toBeEnabled();
  });

  // The header names the field's type the way the picker that created it did,
  // not by the internal id that stored data uses.
  describe("type name", () => {
    const headerType = () =>
      screen.getByText("Type:").parentElement?.textContent;

    it("shows the plain type name", () => {
      render(
        <Builder initial={[{ ...excerpt, type: "richText" }]} fieldId="f-1" />
      );
      expect(headerType()).toBe("Type: Rich text");
    });

    it("names a plugin-contributed type by the label the picker shows", () => {
      branding.current = {
        plugins: [
          {
            name: "acme",
            enabled: true,
            fieldTypes: [
              { type: "acme-colour", label: "Colour swatch", storage: "text" },
            ],
          },
        ],
      };
      try {
        render(
          <Builder
            initial={[{ ...excerpt, type: "acme-colour" }]}
            fieldId="f-1"
          />
        );
        expect(headerType()).toBe("Type: Colour swatch");
      } finally {
        branding.current = {};
      }
    });
  });
});
