/**
 * "Restore this field" on a changed field of a version: the same restore as
 * "Restore…", for one field. Offered where the field can be restored; where it
 * cannot, the field says why instead; and nowhere when no restore is offered.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FieldConfig } from "nextly/config";
import { describe, expect, it, vi } from "vitest";

import type { FieldDiff, VersionDiff } from "@admin/services/versionApi";

import { defineFieldDiff } from "../diff/field-diff-registry";
import type { RestoreRow } from "../restore-plan";
import { VersionChangesForm } from "../VersionChangesForm";
import { versionChangesOf } from "../version-changes";
import { WithheldFieldsProvider } from "../withheld-fields-context";

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins: [] }),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));

const field = (name: string) =>
  ({
    name,
    type: "text",
    label: name[0]!.toUpperCase() + name.slice(1),
  }) as FieldConfig;

const changed = (name: string): FieldDiff => ({
  kind: "text",
  name,
  label: name[0]!.toUpperCase() + name.slice(1),
  type: "text",
  status: "changed",
  segments: [
    { op: -1, text: "before" },
    { op: 1, text: "after" },
  ],
});

const row = (name: string, extra: Partial<RestoreRow> = {}): RestoreRow => ({
  name,
  label: name,
  chosen: true,
  replacesUnsaved: false,
  shared: false,
  value: "after",
  ...extra,
});

function renderChanges(restoreField?: {
  rowFor: (name: string) => RestoreRow | undefined;
  restore: (name: string) => void;
}) {
  const diff: VersionDiff = {
    from: 1,
    to: 2,
    locale: null,
    hasChanges: true,
    incomplete: false,
    fields: [changed("title"), changed("views")],
  };
  return render(
    <WithheldFieldsProvider paths={[]}>
      <VersionChangesForm
        fields={[field("title"), field("views")]}
        values={{ title: "after", views: "after" }}
        changes={versionChangesOf(diff)}
        order={["title", "views"]}
        current={null}
        showUnchanged={false}
        onToggleUnchanged={vi.fn()}
        {...(restoreField ? { restoreField } : {})}
      />
    </WithheldFieldsProvider>
  );
}

describe("Restore this field", () => {
  it("restores the one field it is on", async () => {
    const restore = vi.fn();
    renderChanges({ rowFor: name => row(name), restore });

    const buttons = screen.getAllByRole("button", {
      name: /Restore this field/,
    });
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[1]!);

    expect(restore).toHaveBeenCalledWith("views");
  });

  it("sits in the changed field's heading row, beside its name, and only there", () => {
    renderChanges({ rowFor: name => row(name), restore: vi.fn() });

    const heading = screen.getByRole("heading", { name: /Views/ });
    const headingRow = heading.parentElement as HTMLElement;
    const button = screen.getByRole("button", {
      name: "Restore this field: Views",
    });
    // In the row that names the field and its change, not under its value:
    // the action reads with the field it acts on.
    expect(headingRow).toContainElement(button);
    expect(
      heading.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("says why a field cannot be restored, instead of offering it", () => {
    renderChanges({
      rowFor: name =>
        name === "views"
          ? row(name, {
              chosen: false,
              disabled: "read-only",
              reason: "You can't edit this field",
            })
          : row(name),
      restore: vi.fn(),
    });

    expect(
      screen.getAllByRole("button", { name: /Restore this field/ })
    ).toHaveLength(1);
    expect(screen.getByText("You can't edit this field")).toBeInTheDocument();
  });

  it("offers nothing for a field the editor already holds", () => {
    renderChanges({
      rowFor: name => (name === "title" ? undefined : row(name)),
      restore: vi.fn(),
    });

    expect(
      screen.getAllByRole("button", { name: /Restore this field/ })
    ).toHaveLength(1);
  });

  it("offers nothing where no restore is offered", () => {
    renderChanges();

    expect(
      screen.queryByRole("button", { name: /Restore this field/ })
    ).toBeNull();
  });
});

describe("Restore this field, on a field a registered renderer draws", () => {
  // A plugin's renderer that draws its own row, with no field heading of the
  // comparison's own for the action to sit in.
  defineFieldDiff(["test-own-row"], node => (
    <div>{`${node.name} drawn by its own renderer`}</div>
  ));

  it("still offers the field's restore", async () => {
    const restore = vi.fn();
    const diff = {
      from: 1,
      to: 2,
      locale: null,
      hasChanges: true,
      incomplete: false,
      fields: [
        {
          kind: "test-own-row",
          name: "chart",
          label: "Chart",
          type: "json",
          status: "changed",
        },
      ],
    } as unknown as VersionDiff;
    render(
      <WithheldFieldsProvider paths={[]}>
        <VersionChangesForm
          fields={[field("chart")]}
          values={{ chart: "after" }}
          changes={versionChangesOf(diff)}
          order={["chart"]}
          current={null}
          showUnchanged={false}
          onToggleUnchanged={vi.fn()}
          restoreField={{ rowFor: name => row(name), restore }}
        />
      </WithheldFieldsProvider>
    );

    expect(
      screen.getByText("chart drawn by its own renderer")
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Restore this field: Chart" })
    );
    expect(restore).toHaveBeenCalledWith("chart");
  });

  it("offers it once on a field whose renderer heads it, not twice", () => {
    renderChanges({ rowFor: name => row(name), restore: vi.fn() });

    expect(
      screen.getAllByRole("button", { name: "Restore this field: Title" })
    ).toHaveLength(1);
  });
});
