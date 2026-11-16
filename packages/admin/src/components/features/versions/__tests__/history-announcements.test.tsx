/**
 * What the history screens tell a person who cannot see them: each changed field is a heading,
 * moving between changes says where they are ("Change 2 of 3: Views"), and a restore, and its
 * undo, are said aloud rather than shown only in a toast.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FieldConfig } from "nextly/config";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FieldDiff, VersionDiff } from "@admin/services/versionApi";

import { HISTORY_ANNOUNCER_ID } from "../announce";
import { ChangeNav } from "../ChangeNav";
import { restoreIntoEditor } from "../restore-into-editor";
import { VersionChangesForm } from "../VersionChangesForm";
import { versionChangesOf } from "../version-changes";
import { WithheldFieldsProvider } from "../withheld-fields-context";

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock("@admin/components/ui", async importActual => ({
  ...(await importActual<typeof import("@admin/components/ui")>()),
  toast: { success: toastSuccess },
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins: [] }),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));

afterEach(() => {
  document.getElementById(HISTORY_ANNOUNCER_ID)?.remove();
  toastSuccess.mockReset();
});

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

/** What the history's one announcer says now. */
const announced = () =>
  document.getElementById(HISTORY_ANNOUNCER_ID)?.textContent?.trim() ?? "";

describe("each changed field", () => {
  it("is a heading, named as the editor names the field", () => {
    const diff: VersionDiff = {
      from: 1,
      to: 2,
      locale: null,
      hasChanges: true,
      incomplete: false,
      fields: [changed("title"), changed("views")],
    };
    render(
      <WithheldFieldsProvider paths={[]}>
        <VersionChangesForm
          fields={[field("title"), field("views")]}
          values={{ title: "after", views: "after" }}
          changes={versionChangesOf(diff)}
          order={["title", "views"]}
          current={null}
          showUnchanged={false}
          onToggleUnchanged={vi.fn()}
        />
      </WithheldFieldsProvider>
    );
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Views" })).toBeInTheDocument();
  });
});

describe("moving between changes", () => {
  function Moving({ labels }: { labels: string[] }) {
    const [position, setPosition] = useState(0);
    return (
      <ChangeNav
        changed={labels.length}
        position={position}
        currentLabel={labels[position]}
        onMove={delta =>
          setPosition(
            current => (current + delta + labels.length) % labels.length
          )
        }
      />
    );
  }

  it("says nothing until a move, then where the person is and what is there", async () => {
    render(<Moving labels={["Title", "Views", "SEO › Meta title"]} />);
    expect(screen.getByRole("status")).toHaveTextContent("");

    await userEvent.click(screen.getByRole("button", { name: "Next change" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Change 2 of 3: Views"
    );

    await userEvent.click(screen.getByRole("button", { name: "Next change" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Change 3 of 3: SEO › Meta title"
    );
  });
});

describe("a restore into the editor", () => {
  it("is said aloud, and so is its undo", () => {
    const undo = vi.fn();
    restoreIntoEditor({
      editor: {
        restore: { apply: vi.fn(() => ({ undo })) },
        language: null,
      } as never,
      rows: [
        {
          name: "title",
          label: "Title",
          chosen: true,
          replacesUnsaved: false,
          shared: false,
          value: "a",
        },
        {
          name: "views",
          label: "Views",
          chosen: true,
          replacesUnsaved: false,
          shared: false,
          value: "b",
        },
      ] as never,
      names: ["title", "views"],
      versionNo: 3,
    });
    expect(announced()).toBe("2 fields restored from version 3");

    const options = toastSuccess.mock.calls[0]?.[1] as {
      action: { onClick: () => void };
    };
    options.action.onClick();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(announced()).toBe("Restore undone: 2 fields put back as they were");
  });
});
