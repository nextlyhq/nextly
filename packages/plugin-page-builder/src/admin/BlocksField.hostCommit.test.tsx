// @vitest-environment jsdom

/**
 * What the open editor tells the entry form it sits over.
 *
 * The editor keeps its document to itself until the author leaves, so the form
 * learns about the work in it through three side channels instead: a report
 * that unsaved work exists (which the navigation guard and the save shortcut
 * read), a recovery point holding the WHOLE document with the live layout in
 * it, and a request that the admin hide its own chrome while the editor has the
 * window. Leaving then hands the edited document back as the field's value.
 *
 * Every other suite here stubs those three channels to do nothing, so none of
 * them would notice a channel going quiet or being fed the wrong value. This
 * file records what each channel is told, at rest, at opening and after an
 * edit.
 *
 * The editor's own state is replaced with a small stateful stand-in, because
 * the subject is what this host does when the document CHANGES. Producing a
 * change through the real canvas would need the whole surface, and the change
 * would still be observed here.
 *
 * @module admin/BlocksField.hostCommit.test
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { useForm, useWatch, type Control } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OPEN_BUILDER_ACTION } from "./PageBuilderCard";

/** Each unsaved-work report, as the key it was made under and its value. */
const reports: { key: string; hasWork: boolean }[] = [];

/** Each recovery point the editor handed the form, in render order. */
const snapshots: unknown[] = [];

/** How many times a recovery point was asked to be written. */
let scheduled = 0;

/** Each request to hide the admin's chrome. */
const chromeRequests: { layers: readonly string[]; canExit: boolean }[] = [];

/** The value the field has written back to the form. */
let saved: unknown;

/** Replaces the open editor's document, as one undoable edit would. */
let edit: ((next: BlockDocument) => void) | undefined;

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
    // The exit, behind a button a test can press. Asserting on the handler
    // prop instead would pass on a shell that never rendered a way out.
    BuilderShell: ({
      onExit,
      children,
    }: {
      onExit?: () => void;
      children?: React.ReactNode;
    }): React.JSX.Element => (
      <div>
        <button type="button" onClick={onExit}>
          Leave editor
        </button>
        {children}
      </div>
    ),
    BreakpointManager: nothing,
    BreakpointSwitcher: nothing,
    InspectorPanel: nothing,
    Canvas: nothing,
    BlockKeyboardActions: passthrough,
    BlockContextMenu: passthrough,
    BlockToolbar: nothing,
    EditorCommandPalette: nothing,
    DropIndicator: nothing,
    InsertPanel: nothing,
    LayersPanel: nothing,
    TokensPanel: nothing,
    OnboardingChecklist: nothing,
    SelectionBreadcrumb: nothing,
    SpacingOverlay: nothing,
    useBuilderChecklist: () => ({
      visible: false,
      steps: [],
      dismiss: () => {},
    }),
    useCanvasDrag: () => ({
      handlers: {},
      target: null,
      draggingId: null,
      draggingBlockName: null,
    }),
    /*
     * Stateful, so an edit is a NEW document object and a deeper history —
     * the two facts the host reads. A fixed document would leave every channel
     * reporting its opening state whatever the host did with a change.
     */
    useEditorState: ({
      initialDocument,
    }: {
      initialDocument: BlockDocument;
    }) => {
      const [document, setDocument] = React.useState(initialDocument);
      const [undoDepth, setUndoDepth] = React.useState(0);
      edit = next => {
        setDocument(next);
        setUndoDepth(depth => depth + 1);
      };
      return {
        document,
        selectedId: null,
        selection: { ids: [], primary: null },
        apply: () => null,
        applyAll: () => null,
        select: () => {},
        undo: () => {},
        redo: () => {},
        canUndo: undoDepth > 0,
        canRedo: false,
        undoDepth,
      };
    },
    useInlineEditing: () => ({
      editing: null,
      editingRich: null,
      begin: () => false,
      commit: () => ({ status: "unchanged" }),
      cancel: () => {},
      onDoubleClick: () => {},
    }),
  };
});

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  usePluginClientConfig: () => undefined,
  useDocumentIdentity: () => null,
  useDocumentLocale: () => null,
  // Every plugin read answers with nothing: a site with no stored style, no
  // components and no patterns, which none of these cases is about.
  usePluginRoute: () => ({
    data: undefined,
    pending: false,
    error: null,
    refetch: () => {},
  }),
  usePluginRouteMutation: () => ({
    write: async () => ({ message: "", item: {} }),
    pending: false,
    error: null,
  }),
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
  validationIssues: () => [],
  useDocumentCheckpoint: ({ snapshot }: { snapshot: unknown }) => {
    snapshots.push(snapshot);
    return {
      schedule: () => {
        scheduled += 1;
      },
    };
  },
  useEntryFieldsPanel: () => null,
  useReportUnsavedWork: (key: string, hasWork: boolean) => {
    reports.push({ key, hasWork });
  },
  useSuppressAdminChrome: (request: {
    layers: readonly string[];
    canExit: boolean;
  }) => {
    chromeRequests.push(request);
  },
  useDocumentStatus: () => null,
  useSingleDocument: () => ({
    data: undefined,
    isPending: false,
    error: null,
  }),
  useUpdateSingleDocument: () => ({
    mutateAsync: async () => ({ success: true }),
    isPending: false,
  }),
}));

// Imported after the mocks, which is what makes them take effect.
const { BlocksField } = await import("./BlocksField");

/** A document distinct from the opening one, so a stale hand-back shows. */
const EDITED: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [{ id: "h1", type: "core/heading", props: { text: "Edited" } }],
} as BlockDocument;

/** Watches what the field writes back, which is what a save persists. */
function Saved({
  control,
}: {
  control: Control<{ title: string; body: unknown }>;
}): React.JSX.Element | null {
  saved = useWatch({ control, name: "body" });
  return null;
}

function Host(): React.JSX.Element {
  const { control } = useForm<{ title: string; body: unknown }>({
    defaultValues: { title: "About us", body: undefined },
  });
  return (
    <>
      <BlocksField name="body" control={control} />
      <Saved control={control} />
    </>
  );
}

function openEditor(): void {
  fireEvent.click(screen.getByRole("button", { name: OPEN_BUILDER_ACTION }));
}

function editDocument(): void {
  act(() => edit?.(EDITED));
}

beforeEach(() => {
  reports.length = 0;
  snapshots.length = 0;
  scheduled = 0;
  chromeRequests.length = 0;
  saved = undefined;
  edit = undefined;
});

afterEach(() => {
  cleanup();
});

describe("at rest", () => {
  it("tells the form nothing while the editor is closed", () => {
    render(<Host />);

    // The field renders on every entry form holding a blocks field, open or
    // not; a channel driven from it would hide the admin's navigation and
    // claim unsaved work for every one of those forms.
    expect(reports).toEqual([]);
    expect(snapshots).toEqual([]);
    expect(chromeRequests).toEqual([]);
  });
});

describe("the unsaved-work report", () => {
  it("reports no work under the field's own key when the editor opens", () => {
    render(<Host />);
    openEditor();

    expect(reports.length).toBeGreaterThan(0);
    expect(reports.every(report => report.key === "blocks:body")).toBe(true);
    expect(reports.at(-1)?.hasWork).toBe(false);
  });

  it("reports work once the document has been edited", () => {
    render(<Host />);
    openEditor();
    editDocument();

    // The control for the case above: a report pinned to `false` passes it.
    expect(reports.at(-1)).toEqual({ key: "blocks:body", hasWork: true });
  });
});

describe("the recovery point", () => {
  it("asks for none for the document the editor opened with", () => {
    render(<Host />);
    openEditor();

    // That document is what the server already holds; recording it would
    // offer the author their own unmodified page as unsaved changes.
    expect(scheduled).toBe(0);
  });

  it("asks for one after an edit, holding the whole document with the live layout", () => {
    render(<Host />);
    openEditor();
    editDocument();

    expect(scheduled).toBeGreaterThan(0);
    // The WHOLE document, because restoring one replaces every value: a
    // snapshot of the layout alone would restore and blank the title.
    expect(snapshots.at(-1)).toEqual({ title: "About us", body: EDITED });
  });
});

describe("the admin's chrome", () => {
  it("is asked to step aside, with a way back, while the editor is open", () => {
    render(<Host />);
    openEditor();

    expect(chromeRequests.at(-1)).toEqual({
      layers: [
        "primaryRail",
        "subSidebar",
        "documentSidebar",
        "header",
        "pageFrame",
      ],
      canExit: true,
    });
  });
});

describe("leaving", () => {
  it("hands the EDITED document back to the form and closes", () => {
    render(<Host />);
    openEditor();
    editDocument();
    fireEvent.click(screen.getByRole("button", { name: "Leave editor" }));

    // The edited content, compared by value because the form stores a copy of
    // what it is handed. The opening document is an empty page, so a host
    // that handed that one back would still write a page-shaped value — and
    // fail here on the missing heading.
    expect(saved).toEqual(EDITED);
    expect(screen.queryByRole("button", { name: "Leave editor" })).toBeNull();
  });
});
