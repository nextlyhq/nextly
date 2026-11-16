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
import type { DocumentStatus } from "@nextlyhq/plugin-sdk/admin";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { useForm, type FieldValues } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the entry-fields hook answers with for the test in hand. */
let entryFields: React.ReactNode | null;
/** How the surrounding form reports the document: no status unless a case sets one. */
let documentStatus: DocumentStatus | null = null;
/** Every path the hook was asked about, so the exclusion can be asserted. */
const askedFor: string[] = [];

// The editor asks the session's grants for shared styles; this file is not
// about them, so the author holds the right to change the site's design.
vi.mock("@nextlyhq/plugin-sdk/client", () => ({
  useCan: (permission: string) => permission === "update-site-style",
}));

vi.mock("@nextlyhq/builder/shell", async importOriginal => {
  const real = await importOriginal<Record<string, unknown>>();
  // Every panel the shell knows, so the renderer can be asked about each.
  const { LEFT_PANELS } = await import("@nextlyhq/builder");
  const view = { current: null, choose: () => {} };
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
      topBarCenter,
      topBarEnd,
      renderSettings,
    }: {
      renderPanel?: (
        panel: string,
        view: { current: string | null; choose: (view: string) => void }
      ) => React.ReactNode;
      availablePanels?: readonly string[];
      topBar?: React.ReactNode;
      topBarCenter?: React.ReactNode;
      topBarEnd?: React.ReactNode;
      renderSettings?: (dialog: {
        open: boolean;
        onOpenChange: (open: boolean) => void;
        returnFocus: () => HTMLElement | null;
      }) => React.ReactNode;
    }): React.JSX.Element => (
      <div>
        <div data-testid="rail">{(availablePanels ?? []).join(",")}</div>
        <div data-testid="filled">
          {LEFT_PANELS.filter(
            panel => (renderPanel?.(panel, view) ?? null) !== null
          ).join(",")}
        </div>
        <div data-testid="panel">{renderPanel?.("settings", view)}</div>
        <div data-testid="settings">
          {renderSettings?.({
            open: true,
            onOpenChange: () => {},
            returnFocus: () => null,
          })}
        </div>
        <div data-testid="topbar">
          {topBar}
          {topBarCenter}
          {topBarEnd}
        </div>
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

// The dialog stands in as what it is handed: the entry's own fields.
vi.mock("./editor/settings-dialog", () => ({
  SettingsDialog: ({ pageFields }: { pageFields: React.ReactNode }) => (
    <div>{pageFields}</div>
  ),
}));

/** Asking the stored style again, as the editor does after a save. */
const refetchStoredStyle = async () => ({ isError: false });
// The stored site style arrives through the editor's one read, the plugin's
// route; that read's request is asserted in `site-style-read.test`.
vi.mock("./site-style-read", () => ({
  useStoredSiteStyle: () => ({
    data: undefined,
    isPending: false,
    error: null,
    refetch: refetchStoredStyle,
  }),
}));

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  // The status pill's rule and words, the admin's own: the pill is drawn for
  // real here, so a published page with edits is read as the bar shows it.
  savedPillState: (
    await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()
  ).savedPillState,
  PILL_LABEL: (
    await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()
  ).PILL_LABEL,
  // The canvas's media read, answering nothing: these cases draw no image.
  // One function for every call, as the admin's own hook keeps it.
  useMediaResolver: (
    read => () =>
      read
  )(() => Promise.resolve(null)),
  // The Fallback picker's library search, finding nothing: no case here
  // opens it. One function for every call, as the admin's own hook keeps it.
  useMediaSearcher: (
    search => () =>
      search
  )(() => Promise.resolve([])),
  // The host's font table, which the real entry re-exports from core.
  WEB_FONT_FORMATS: (await import("nextly/config")).WEB_FONT_FORMATS,
  // The editor mount asks for the variant-use writer; no case here opens a
  // component, so it is never called.
  usePluginRouteMutation: () => ({
    write: async () => undefined,
    pending: false,
    error: null,
  }),
  // The media library, drawn as nothing: these cases never open it.
  MediaPickerDialog: () => null,
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  usePluginClientConfig: () => ({}),
  // No document around the field: the state every case here was written
  // against, and the one that offers every component.
  useDocumentIdentity: () => null,
  navigateTo: vi.fn(),
  // Nor a language the field could know: the component read asks for the
  // app default.
  useDocumentLocale: () => null,
  /*
   * The library read. Absent here rather than stubbed with patterns, because
   * these cases are about other surfaces and an offered pattern would change
   * what the palette contains. `pending: false` says the read ANSWERED with
   * nothing, which is the site with an empty library — the state every one of
   * these cases was written against.
   */
  usePluginRoute: () => ({
    data: undefined,
    pending: false,
    error: null,
    refetch: () => {},
  }),
  useDocumentCheckpoint: () => ({ schedule: () => {} }),
  useEntryFieldsPanel: (excludePath: string) => {
    askedFor.push(excludePath);
    return entryFields;
  },
  useReportUnsavedWork: () => {},
  useSuppressAdminChrome: () => {},
  // The form's storing gate, which site style writes are tracked with.
  useTrackedWrite: () => () => {},
  useBeforeDocumentAction: () => {},
  // The header's controls the bar places; drawn by the admin, not here.
  DocumentSaveIndicator: () => null,
  DocumentPrimaryAction: () => null,
  useDocumentActions: () => null,
  // No preview here: the top bar's Preview draws nothing.
  useDocumentPreview: () => null,
  // No one signed in: the editor keeps no preferences.
  useCurrentUserId: () => null,
  useDocumentStatus: () => documentStatus,
  // The editor registers its restore; nothing here offers one.
  useDocumentRestore: () => undefined,
  validationIssues: () => [],
  useUpdateSingleDocument: () => ({
    mutateAsync: async () => ({ success: true }),
    isPending: false,
  }),
}));

/**
 * Whether the editor told the Pages panel it holds unsaved work, on each
 * render: the panel is the editor's reader of "the document is dirty" (it asks
 * before switching page), and the shell above draws every panel on each
 * render, so each render records one answer.
 */
const unsavedWorkTold: boolean[] = [];

vi.mock("./editor/pages-panel", () => ({
  usePagesPanel: () => ({
    currentPage: null,
    settingsRequest: undefined,
    renderPagesPanel: ({ unsavedWork }: { unsavedWork: boolean }) => {
      unsavedWorkTold.push(unsavedWork);
      // Something, so the panel still counts as filled.
      return <span data-testid="pages-panel" />;
    },
  }),
}));

const { PageBuilderView } = await import("./editor/PageBuilderView");

/**
 * The blocks field's declaration, as the admin hands it to the view. Typed at
 * the boundary because `FieldConfig` is the closed union of the built-in
 * shapes, and a contributed type such as `blocks` has no arm in it.
 */
const BODY_FIELD = { name: "body", type: "blocks" } as never;

/**
 * The document's form, with the builder's view drawn over it while `open`.
 *
 * The form stays mounted whether or not the view is, as it does in the admin
 * when an author moves between the edit form and the builder, so a case can
 * write to the form first and open the view on what it holds.
 */
function Host({ open = true }: { open?: boolean }): React.JSX.Element {
  const { control, register, setValue } = useForm<FieldValues>({
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
      {open ? (
        <PageBuilderView
          control={control}
          field={BODY_FIELD}
          readOnly={false}
          exit={() => {}}
        />
      ) : null}
    </>
  );
}

function openEditor(): void {
  render(<Host />);
}

/** The rail's panel list, as the shell was handed it. */
const rail = (): string => screen.getByTestId("rail").textContent ?? "";

beforeEach(() => {
  entryFields = null;
  documentStatus = null;
  askedFor.length = 0;
  unsavedWorkTold.length = 0;
});

afterEach(cleanup);

describe("Settings, as a dialog rather than a panel", () => {
  it("is never a left panel, with fields to show or without", () => {
    for (const fields of [null, <p key="f">the entry&apos;s other fields</p>]) {
      entryFields = fields;
      openEditor();
      expect(rail()).not.toContain("settings");
      // Nothing is drawn into a Settings panel either.
      expect(screen.getByTestId("panel").childElementCount).toBe(0);
      cleanup();
    }
  });

  it("hands the dialog the entry's own fields to show", () => {
    entryFields = <p>the entry&apos;s other fields</p>;
    openEditor();
    expect(screen.getByTestId("settings").textContent).toContain(
      "the entry's other fields"
    );
  });

  it("offers the same panels whether or not there are fields", () => {
    entryFields = null;
    openEditor();
    const withoutFields = rail();
    cleanup();

    entryFields = <p>fields</p>;
    openEditor();
    expect(rail()).toBe(withoutFields);
    for (const panel of ["add", "layers", "components", "design"]) {
      expect(withoutFields).toContain(panel);
    }
  });

  it("offers exactly the panels it fills, in both states", () => {
    // The rail leaves out what the host does not offer, so a panel the
    // renderer fills but the list forgets is unreachable, and one the list
    // offers but the renderer leaves empty opens blank. Asked of every panel
    // the shell knows, rather than of the ones this file expects.
    const filled = (): string => screen.getByTestId("filled").textContent ?? "";
    entryFields = null;
    openEditor();
    expect(filled()).toBe(rail());
    expect(rail()).not.toBe("");
    cleanup();

    entryFields = <p>fields</p>;
    openEditor();
    expect(filled()).toBe(rail());
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
     * The editor's reading of unsaved work once used `undoDepth` alone, which
     * is the editor's own history. Once this panel makes the entry's fields
     * editable, an author can rename the page, touch no block, and be told
     * there is nothing to lose — two surfaces writing to one document with
     * the answer covering only one of them.
     */
    entryFields = <p>fields</p>;
    openEditor();
    expect(unsavedWorkTold.at(-1)).toBe(false);

    fireEvent.change(screen.getByLabelText("title"), {
      target: { value: "Renamed" },
    });

    expect(unsavedWorkTold.at(-1)).toBe(true);
  });

  it("still reports clean when nothing has been touched at all", () => {
    // The control. A reading hardwired to dirty would satisfy the case above.
    entryFields = <p>fields</p>;
    openEditor();

    expect(unsavedWorkTold.length).toBeGreaterThan(0);
    expect(unsavedWorkTold.every(d => d === false)).toBe(true);
  });

  it("still reports dirty for unsaved BLOCKS after the editor is reopened", () => {
    /*
     * The case an earlier version discarded. Leaving the editor commits the
     * document into the form, so the blocks field is dirty; reopening builds a
     * fresh editor whose `undoDepth` is zero. Excluding the field from
     * `dirtyFields` — which that version did, to avoid double-counting the undo
     * history — removed the only remaining witness, and the editor read clean
     * over blocks that had never been saved.
     *
     * Double-counting cannot matter to a boolean, and the form's baseline is
     * advanced by the reset on a successful submit, so a dirty blocks field
     * means genuinely unsaved blocks.
     */
    entryFields = <p>fields</p>;
    const view = render(<Host open={false} />);

    // Commit blocks the way leaving the editor does, then open a fresh one
    // over the same form.
    fireEvent.click(screen.getByRole("button", { name: "commit blocks" }));
    view.rerender(<Host open />);

    expect(unsavedWorkTold.at(-1)).toBe(true);
  });
});

describe("the page status beside unsaved work", () => {
  /** The pill's visible words, without its screen-reader subject. */
  const pillWords = (): string =>
    screen
      .getByText(/Page status/)
      .parentElement?.textContent?.replace("Page status: ", "") ?? "";

  it("still reads Published after an edit, leaving unsaved work to the save chip", () => {
    /*
     * A published page with an edit used to read "Modified" here while the
     * save chip said "Unsaved changes": two signals for one state. The pill
     * reports where the SAVED page stands, as the entry page's does.
     */
    documentStatus = { status: "published", hasWorkingDraft: false };
    entryFields = <p>fields</p>;
    openEditor();
    expect(pillWords()).toBe("Published");

    fireEvent.change(screen.getByLabelText("title"), {
      target: { value: "Renamed" },
    });

    // The editor does hold unsaved work, so this is the state in question
    // and not a page the edit never reached.
    expect(unsavedWorkTold.at(-1)).toBe(true);
    expect(pillWords()).toBe("Published");
  });

  it("reads Changed for a published page with a saved working draft", () => {
    // The positive control: the pill still follows the saved status, so the
    // case above is not a pill stuck on "Published".
    documentStatus = { status: "published", hasWorkingDraft: true };
    openEditor();
    expect(pillWords()).toBe("Changed");
  });
});
