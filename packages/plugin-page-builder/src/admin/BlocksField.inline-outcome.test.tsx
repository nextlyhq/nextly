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
 * @module admin/BlocksField.inline-outcome.test
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { useForm, useWatch, type Control } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InlineEditOutcome } from "@nextlyhq/builder/shell";
import { OPEN_BUILDER_ACTION } from "./PageBuilderCard";

/** What the inline surface answers when this test's editor is finished. */
let outcome: InlineEditOutcome = { status: "unchanged" };

/** Errors raised for the author. */
const errors: string[] = [];

/** The value the field has written back to the form. */
let saved: unknown;

/** How many times the inline passage has been asked to commit. */
let commits = 0;

/** The save-as-pattern verb the editor published, so a test can run it. */
let offeredSaveVerb: (() => void) | undefined;

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
      // The shortcut context comes with the real shell, and the save form holds
      // the keyboard while it is open — so a plain div here fails inside the
      // form rather than telling us anything about the subject.
      <ShortcutProvider>
        <div>
          <button type="button" onClick={onExit}>
            Leave editor
          </button>
          {children}
        </div>
      </ShortcutProvider>
    ),
    BreakpointManager: nothing,
    BreakpointSwitcher: nothing,
    InspectorPanel: nothing,
    Canvas: nothing,
    /*
     * Records the save-as-pattern verb as well as passing children through. The
     * verb is published to the toolbar, the context menu and the palette alike,
     * so capturing it here is capturing what all three would run — and running
     * it is the only way to observe what the editor does with an open passage.
     */
    BlockKeyboardActions: ({
      children,
      onSaveAsPattern,
    }: {
      children?: React.ReactNode;
      onSaveAsPattern?: () => void;
    }): React.JSX.Element => {
      offeredSaveVerb = onSaveAsPattern;
      return <>{children}</>;
    },
    /*
     * Passed THROUGH, not stubbed to nothing: the canvas renders inside it, so
     * a stub would take the recorder below out of the tree along with it. The
     * real one reads the verbs context, which the passthrough above does not
     * provide.
     */
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
    // `draggingBlockName` is part of the state this hook reports and is what
    // the editor asks "is a drag happening" — a stub omitting it answers
    // `undefined`, which is not `null`, so the editor hides its chrome for a
    // drag that is not happening.
    useCanvasDrag: () => ({
      handlers: {},
      target: null,
      draggingId: null,
      draggingBlockName: null,
    }),
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
    /*
     * Answers the chosen outcome AND reports it the way the real hook does —
     * through the callback, on every commit including the host's own. A stub
     * that only returned it would let this file pass against a host that never
     * wired the callback at all, which is the defect this replaced.
     *
     * That the REAL hook reports from blur, from being superseded and from
     * unmount is asserted in the builder's own suite against the real hook.
     * The division is deliberate: there, that the outcome is produced; here,
     * that this component acts on it.
     */
    useInlineEditing: (
      _editor: unknown,
      _load: unknown,
      onFinished?: (finished: InlineEditOutcome) => void
    ) => ({
      editing: null,
      editingRich: null,
      begin: () => false,
      commit: () => {
        commits += 1;
        onFinished?.(outcome);
        return outcome;
      },
      cancel: () => {},
      onDoubleClick: () => {},
    }),
  };
});

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  usePluginClientConfig: () => undefined,
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
  /*
   * The save form's write and the two helpers that phrase its refusals. Never
   * exercised by these cases — they stop at whether the form opens — but the
   * modules the form imports resolve them at load, so omitting one is a missing
   * export rather than an unused stub.
   */
  usePluginRouteMutation: () => ({
    write: async () => ({ message: "Pattern created.", item: { id: "p1" } }),
    pending: false,
    error: null,
  }),
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
  validationIssues: () => [],
  /*
   * `schedule` is what the editor actually calls; `record`/`clear` were a shape
   * this mock invented and nothing has. It went unnoticed because the call sits
   * behind "the document changed since it opened", which no case here had
   * reached — so the stub answered every question it was asked and none of the
   * ones it would be.
   */
  useDocumentCheckpoint: () => ({ schedule: () => {} }),
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
  fireEvent.click(screen.getByRole("button", { name: OPEN_BUILDER_ACTION }));
}

/** Whether the editor is still up, which is what holds the author's words. */
function editorIsOpen(): boolean {
  return screen.queryByRole("button", { name: "Leave editor" }) !== null;
}

beforeEach(() => {
  outcome = { status: "unchanged" };
  errors.length = 0;
  saved = undefined;
  commits = 0;
  offeredSaveVerb = undefined;
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
    expect(
      screen.queryByRole("button", { name: OPEN_BUILDER_ACTION })
    ).toBeNull();
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

  it("says which passage is blocking when the editor could not be opened", () => {
    // The author double-clicked and nothing happened. Without a message that is
    // the editor appearing broken, on the one path where it is working exactly
    // as intended — protecting words it refused to overwrite.
    outcome = { status: "unavailable" };

    openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Leave editor" }));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("has not been saved");
    // Nothing is being held HERE, so leaving is not blocked.
    expect(editorIsOpen()).toBe(false);
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
  /**
   * The save chord, on the document, where the capture-phase listener sits.
   *
   * Control rather than Command because `mod` resolves per platform and jsdom
   * reports a non-Apple one. Pressing Command here would assert that the
   * WRONG modifier saves, which is the defect the exact matcher removes.
   */
  function pressSave(): void {
    fireEvent.keyDown(document, { key: "s", ctrlKey: true });
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

  it("ignores a modified variant the form does not treat as save", () => {
    /*
     * `mod+s` is matched EXACTLY by the shortcut manager, so Ctrl+Shift+S does
     * not submit the form. A broader predicate here would finish the passage
     * and change the field for a keystroke that saved nothing — and on several
     * platforms Ctrl+Shift+S is the browser's Save As, so the author would be
     * looking at a file dialog while it happened.
     */
    outcome = { status: "unchanged" };

    openEditor();
    fireEvent.keyDown(document, { key: "s", ctrlKey: true, shiftKey: true });

    expect(saved).toBeUndefined();

    fireEvent.keyDown(document, { key: "s", ctrlKey: true, altKey: true });

    expect(saved).toBeUndefined();

    // The platform's OTHER modifier is not the chord either, and this is the
    // control: an assertion that nothing ever saves would pass the two above.
    fireEvent.keyDown(document, { key: "s", metaKey: true });

    expect(saved).toBeUndefined();

    pressSave();

    expect(saved).toMatchObject({ kind: "page" });
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

describe("saving a pattern while a passage is still open", () => {
  it("commits the passage FIRST, so the words on screen are the words stored", () => {
    // A rich-text editor holds the author's text itself while they type — the
    // canvas keeps the caret still — so the document the editor holds during an
    // open passage is the one from before it. A form snapshotting that stores a
    // pattern missing what is on screen, silently.
    openEditor();

    React.act(() => {
      offeredSaveVerb?.();
    });

    expect(commits).toBe(1);
  });

  it("declines to open the form when the commit was REFUSED", () => {
    // The same rule leaving the editor follows, and for the same reason: the
    // words are in the passage and nowhere else. Opening a modal over them
    // invites the author to save a pattern without the text they just wrote,
    // and to walk away from the passage while they are at it.
    outcome = { status: "refused", reason: "Too large." };
    openEditor();

    React.act(() => {
      offeredSaveVerb?.();
    });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens it when the commit went through", () => {
    // The control. Without it the case above passes against an editor whose
    // save verb never opens anything.
    openEditor();

    React.act(() => {
      offeredSaveVerb?.();
    });

    expect(
      screen.getByRole("heading", { name: /save as pattern/i })
    ).toBeTruthy();
  });
});
