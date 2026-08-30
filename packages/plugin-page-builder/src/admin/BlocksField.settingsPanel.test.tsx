// @vitest-environment jsdom

/**
 * Whether the Settings panel is OFFERED, and whether what fills it agrees.
 *
 * The rail and the panel body are two decisions taken from one question — is
 * there anything to show — and while they were taken separately they could
 * disagree. They did: every entry form supplies a field renderer, so a gate on
 * the renderer's existence was true even for a collection whose only fields are
 * its title, its slug and the builder field itself. The rail offered Settings,
 * the region was reserved, and it opened blank.
 *
 * So the assertions here are deliberately PAIRED — rail and body, in the same
 * test, from the same render. Checking either alone is what let them drift: a
 * body that renders nothing passes any test that only reads the rail, and a
 * panel nobody offers passes any test that only reads the body.
 *
 * Every sibling file in this directory mocks `useEntryFieldsPanel` to `null`,
 * which is the state where Settings is correctly absent — so the branch where
 * it IS offered had no coverage anywhere before this file.
 *
 * The builder shell is replaced with recorders rather than rendered, as
 * `BlocksField.fonts.test` does and for its reason: what is under test is which
 * props this component passes.
 *
 * @module admin/BlocksField.settingsPanel.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the entry-fields hook answers with for the test in hand. */
let entryFields: React.ReactNode | null;
/** Every path the hook was asked about, so the exclusion can be asserted. */
const askedFor: string[] = [];

vi.mock("@nextlyhq/builder/shell", async importOriginal => {
  const real = await importOriginal<Record<string, unknown>>();
  const nothing = (): null => null;
  const passthrough = ({
    children,
  }: {
    children?: React.ReactNode;
  }): React.JSX.Element => <>{children}</>;
  return {
    ...real,
    /*
      This shell CALLS `renderPanel` and also reports `availablePanels`, which
      is what lets one render answer both halves of the question. A shell that
      exposed only one of them would reproduce the split this file exists to
      close.
    */
    BuilderShell: ({
      renderPanel,
      availablePanels,
      topBar,
    }: {
      renderPanel?: (panel: string) => React.ReactNode;
      availablePanels?: readonly string[];
      topBar?: React.ReactNode;
    }): React.JSX.Element => (
      <div>
        <div data-testid="rail">{(availablePanels ?? []).join(",")}</div>
        <div data-testid="panel">{renderPanel?.("settings")}</div>
        <div data-testid="topbar">{topBar}</div>
      </div>
    ),
    BlockKeyboardActions: passthrough,
    BlockToolbar: nothing,
    BreakpointManager: nothing,
    BreakpointSwitcher: nothing,
    InspectorPanel: nothing,
    InsertPanel: nothing,
    LayersPanel: nothing,
    TokensStudio: nothing,
    BlockContextMenu: passthrough,
  };
});

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  usePluginClientConfig: () => ({}),
  useDocumentCheckpoint: () => ({ schedule: () => {} }),
  useEntryFieldsPanel: (excludePath: string) => {
    askedFor.push(excludePath);
    return entryFields;
  },
  useReportUnsavedWork: () => {},
  useSuppressAdminChrome: () => {},
  useDocumentStatus: () => null,
  validationIssues: () => [],
  useSingleDocument: () => ({ data: undefined, isPending: false, error: null }),
  useUpdateSingleDocument: () => ({
    mutateAsync: async () => ({ success: true }),
    isPending: false,
  }),
}));

/** What the status pill was told on the most recent render. */
const pillDirty: boolean[] = [];

vi.mock("./DocumentStatusPill", () => ({
  DocumentStatusPill: ({ isDirty }: { isDirty: boolean }) => {
    pillDirty.push(isDirty);
    return <span data-testid="pill">{isDirty ? "dirty" : "clean"}</span>;
  },
}));

const { BlocksField } = await import("./BlocksField");

function Host(): React.JSX.Element {
  const { control, register, setValue } = useForm({
    defaultValues: { body: undefined, title: "" },
  });
  return (
    <>
      {/* Stands in for a field the settings panel edits. It is registered on
          the SAME form, which is what makes it dirty the way that panel's
          fields are. */}
      <input aria-label="title" {...register("title")} />
      {/* Writes the BLOCKS field the way leaving the editor does: `done`
          commits the document into the form, which is what makes that field
          dirty while no editor is mounted. */}
      <button
        type="button"
        onClick={() =>
          setValue(
            "body",
            { formatVersion: 1, kind: "page", nodes: [] } as never,
            { shouldDirty: true }
          )
        }
      >
        commit blocks
      </button>
      <BlocksField name="body" control={control} />
    </>
  );
}

function openEditor(): void {
  render(<Host />);
  fireEvent.click(screen.getByRole("button", { name: "Edit blocks" }));
}

/** The rail's panel list, as the shell was handed it. */
const rail = (): string => screen.getByTestId("rail").textContent ?? "";

beforeEach(() => {
  entryFields = null;
  askedFor.length = 0;
  pillDirty.length = 0;
});

afterEach(cleanup);

describe("offering the Settings panel", () => {
  it("withholds it, and renders nothing into it, when there are no fields", () => {
    /*
     * The state a document reaches when the builder field is all it has beside
     * its identity — and the state of every surface outside an entry form.
     * Both halves are asserted because the defect was that they disagreed:
     * withholding the rail slot while still rendering a body would be just as
     * wrong, and no test that read one of them could tell.
     */
    entryFields = null;
    openEditor();

    expect(rail()).not.toContain("settings");
    const panel = screen.getByTestId("panel");
    // Both, because they fail differently: a body that rendered an empty
    // wrapper has no text and is not empty, and it is the wrapper that would
    // reserve the region.
    expect(panel.textContent).toBe("");
    expect(panel.childElementCount).toBe(0);
  });

  it("offers it AND fills it when the form has fields to give back", () => {
    // The branch nothing covered. A panel that is offered must have a body, and
    // this is the pairing that says so from one render.
    entryFields = <p>the entry&apos;s other fields</p>;
    openEditor();

    expect(rail()).toContain("settings");
    expect(screen.getByTestId("panel").textContent).toContain(
      "the entry's other fields"
    );
  });

  it("leaves the OTHER panels alone in both states", () => {
    /*
     * The control. `settings` is the only slot this decision governs, so a
     * change that withheld the whole rail — or that offered every panel
     * unconditionally — would satisfy the two cases above and be caught only
     * here.
     */
    entryFields = null;
    openEditor();
    const withoutSettings = rail();
    cleanup();

    entryFields = <p>fields</p>;
    openEditor();
    const withSettings = rail();

    for (const panel of ["insert", "layers", "tokens", "fonts", "classes"]) {
      expect(withoutSettings).toContain(panel);
      expect(withSettings).toContain(panel);
    }
    // And the two differ by exactly the one slot under test.
    expect(withSettings).not.toBe(withoutSettings);
  });

  it("asks about the builder field's OWN path, so it is never offered itself", () => {
    // Rendering this editor inside this editor's settings panel would nest an
    // editor in its own chrome. The exclusion is the caller's to state, and it
    // can only state it correctly if it passes its own name.
    entryFields = <p>fields</p>;
    openEditor();

    expect(askedFor.length).toBeGreaterThan(0);
    expect(new Set(askedFor)).toEqual(new Set(["body"]));
  });

  it("reports the document dirty when only a SETTINGS field was edited", () => {
    /*
     * The pill read `undoDepth` alone, which is the editor's own history. Once
     * this panel makes the entry's fields editable, an author can rename the
     * page, touch no block, and be told the document is saved — two surfaces
     * writing to one document with the status answering for only one of them.
     */
    entryFields = <p>fields</p>;
    openEditor();
    expect(pillDirty.at(-1)).toBe(false);

    fireEvent.change(screen.getByLabelText("title"), {
      target: { value: "Renamed" },
    });

    expect(pillDirty.at(-1)).toBe(true);
  });

  it("still reports clean when nothing has been touched at all", () => {
    // The control. A pill hardwired to dirty would satisfy the case above.
    entryFields = <p>fields</p>;
    openEditor();

    expect(pillDirty.length).toBeGreaterThan(0);
    expect(pillDirty.every(d => d === false)).toBe(true);
  });

  it("still reports dirty for unsaved BLOCKS after the editor is reopened", () => {
    /*
     * The case an earlier version discarded. Leaving the editor commits the
     * document into the form, so the blocks field is dirty; reopening builds a
     * fresh editor whose `undoDepth` is zero. Excluding the field from
     * `dirtyFields` — which that version did, to avoid double-counting the undo
     * history — removed the only remaining witness, and the pill read clean
     * over blocks that had never been saved.
     *
     * Double-counting cannot matter to a boolean, and the form's baseline is
     * advanced by the reset on a successful submit, so a dirty blocks field
     * means genuinely unsaved blocks.
     */
    entryFields = <p>fields</p>;
    render(<Host />);

    // Commit blocks the way leaving the editor does, then open a fresh one.
    fireEvent.click(screen.getByRole("button", { name: "commit blocks" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit blocks" }));

    expect(pillDirty.at(-1)).toBe(true);
  });
});
