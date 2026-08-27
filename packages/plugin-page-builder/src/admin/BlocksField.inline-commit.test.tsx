// @vitest-environment jsdom

/**
 * What the editor does when an inline edit could not be written.
 *
 * The builder's own suite asserts that a refused commit KEEPS the passage open,
 * because the author's words live in the editor and nowhere else. That is only
 * half of it: the surface can hold the passage perfectly and this host can
 * still close the canvas a moment later, which unmounts the editor and takes
 * the words with it. The distinction exists to be acted on, and this file is
 * where it is acted on.
 *
 * The inline surface is replaced with a recorder that answers a chosen outcome.
 * What is under test is this component's response to that answer, so driving
 * the answer directly is the assertion; producing a genuine refusal would need
 * a real editor, a real document race, and would still be observed here.
 *
 * @module admin/BlocksField.inline-commit.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { useForm, useWatch, type Control } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InlineCommit } from "@nextlyhq/builder/shell";

/** What the inline surface answers when this test's editor is finished. */
let outcome: InlineCommit = { status: "unchanged" };

/** Errors raised for the author. */
const errors: string[] = [];

/** The value the field has written back to the form. */
let saved: unknown;

vi.mock("@nextlyhq/ui", async importOriginal => {
  // Spread rather than replaced: the shell below is the REAL module and draws
  // real components from here, so a closed literal would blank them.
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    toast: {
      error: (message: string) => errors.push(message),
      success: () => {},
      info: () => {},
    },
  };
});

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
     * The exit affordance is the subject. The real shell draws it from
     * `onExit`, and this stub renders the same handler behind a button so a
     * test can press it — asserting on the handler prop instead would pass on
     * a shell that never rendered a way out.
     */
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
    useCanvasDrag: () => ({ handlers: {}, target: null }),
    useEditorState: () => ({
      document: { formatVersion: 1, kind: "page", nodes: [] },
      selectedId: null,
      selection: { ids: [], primary: null },
      apply: () => null,
      applyAll: () => null,
      select: () => {},
      undo: () => {},
      redo: () => {},
      canUndo: false,
      canRedo: false,
      undoDepth: 0,
    }),
    useInlineText: () => ({ onDoubleClick: () => {} }),
    useInlineEditing: () => ({
      editing: null,
      editingRich: null,
      begin: () => false,
      commit: () => outcome,
      cancel: () => {},
      onDoubleClick: () => {},
    }),
  };
});

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  usePluginClientConfig: () => undefined,
  useDocumentCheckpoint: () => ({ record: () => {}, clear: () => {} }),
  useEntryFieldsPanel: () => null,
  useReportUnsavedWork: () => {},
  useSuppressAdminChrome: () => {},
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

/** Watches what the field writes back, which is what a save actually persists. */
function Saved({
  control,
}: {
  control: Control<{ body: unknown }>;
}): React.JSX.Element | null {
  saved = useWatch({ control, name: "body" });
  return null;
}

function Host(): React.JSX.Element {
  const { control } = useForm<{ body: unknown }>({
    defaultValues: { body: undefined },
  });
  return (
    <>
      <BlocksField name="body" control={control} />
      <Saved control={control} />
    </>
  );
}

/** Mount the field and open the editor. */
function openEditor(): void {
  render(<Host />);
  fireEvent.click(screen.getByRole("button", { name: "Edit blocks" }));
}

/** Whether the editor is still up, which is what holds the author's words. */
function editorIsOpen(): boolean {
  return screen.queryByRole("button", { name: "Leave editor" }) !== null;
}

beforeEach(() => {
  outcome = { status: "unchanged" };
  errors.length = 0;
  saved = undefined;
});

afterEach(() => {
  cleanup();
});

describe("leaving the editor with an inline edit that could not be written", () => {
  it("does not close while the passage is still holding the author's words", () => {
    outcome = { status: "refused", reason: "moved-on" };

    openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Leave editor" }));

    // Closing unmounts the canvas and the editor attached to it, and the typed
    // passage exists nowhere else — so this is the difference between the
    // author keeping their paragraph and losing it without being asked.
    expect(editorIsOpen()).toBe(true);
    expect(screen.queryByRole("button", { name: "Edit blocks" })).toBeNull();
  });

  it("tells the author why leaving did nothing", () => {
    outcome = { status: "refused", reason: "moved-on" };

    openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Leave editor" }));

    // Refusing in silence is its own defect: the exit button would simply stop
    // working, with nothing on screen explaining it.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("edited somewhere else");
  });

  it("says a capped passage can be shortened rather than blaming another editor", () => {
    outcome = { status: "refused", reason: "rejected" };

    openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Leave editor" }));

    expect(editorIsOpen()).toBe(true);
    expect(errors[0]).toContain("Shortening");
  });

  it("closes and says the typing was lost when the passage was discarded", () => {
    // Nothing is being held, so refusing to close would trap the author in an
    // editor they cannot leave to protect words that are already gone.
    outcome = { status: "discarded" };

    openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Leave editor" }));

    expect(editorIsOpen()).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("not saved");
  });

  it("closes silently when the edit finished normally", () => {
    // The control. An editor that refused to close, or complained, whenever an
    // inline edit had been open would pass every case above.
    outcome = { status: "unchanged" };

    openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Leave editor" }));

    expect(editorIsOpen()).toBe(false);
    expect(errors).toEqual([]);
  });
});

describe("the save shortcut with an inline edit that could not be written", () => {
  /** The chord, on the document, where the capture-phase listener sits. */
  function pressSave(): void {
    fireEvent.keyDown(document, { key: "s", metaKey: true });
  }

  it("still saves the rest of the document when the passage was refused", () => {
    /*
     * The opposite of leaving. Withholding the save would lose everything else
     * the author had done in order to protect a paragraph that is not going
     * anywhere — it stays in the editor, on screen, and the message is what
     * tells them it is still there.
     */
    outcome = { status: "refused", reason: "moved-on" };

    openEditor();
    pressSave();

    expect(saved).toMatchObject({ kind: "page" });
    expect(editorIsOpen()).toBe(true);
    expect(errors).toHaveLength(1);
  });

  it("saves without complaining when the edit finished normally", () => {
    // The control: a message on every save would train the author to ignore it.
    outcome = { status: "unchanged" };

    openEditor();
    pressSave();

    expect(saved).toMatchObject({ kind: "page" });
    expect(errors).toEqual([]);
  });
});
