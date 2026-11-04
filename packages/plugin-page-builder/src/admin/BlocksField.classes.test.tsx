// @vitest-environment jsdom

/**
 * The site's class library reaching the inspector, and a new class reaching the
 * site style.
 *
 * `class-library.test.ts` in the builder asserts the RULES and
 * `class-selector.test.tsx` asserts the surface. What is only true HERE is the
 * wiring: that this component hands the inspector a library at all, that it
 * tells a read still in flight apart from a library that is genuinely empty,
 * and that creating a class writes the `classes` section and answers with the
 * id rather than applying it.
 *
 * Every rule can be correct while the props are absent — the selector renders
 * perfectly in isolation, its own tests pass, and no author ever sees it. That
 * failure has already happened once on this chain, one component further up.
 *
 * The builder shell is replaced with recorders rather than rendered, as
 * `BlocksField.breakpoints.test` does and for its reason: what is under test is
 * which props this component passes.
 *
 * @module admin/BlocksField.classes.test
 */
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { useForm, type FieldValues } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DOCUMENT = { formatVersion: 1, kind: "page", nodes: [] };

/** Props the inspector recorder captured on the most recent render. */
const seen: {
  inspector: Record<string, unknown> | undefined;
  verbs: Record<string, unknown> | undefined;
  saveDialog: Record<string, unknown> | undefined;
} = {
  inspector: undefined,
  verbs: undefined,
  saveDialog: undefined,
};

/** What `usePluginClientConfig` answers with for the test in hand. */
let clientConfig: Record<string, unknown> | undefined;
/** What the stored site-style read reports, so `pending` can be driven. */
let storedRead: { data: unknown; isPending: boolean; error: unknown };
/** What a save answers, and what it was handed. */
let saveResult: { success: boolean } | Error;
const saved: Array<Record<string, unknown>> = [];
/** How many times the top bar's breakpoint manager has been mounted. */
let managerMounts = 0;
/** The steps the editor's history was handed. */
const recorded: Array<{
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
}> = [];

// The editor asks the session's grants for shared styles; this file is not
// about them, so the author holds the right to change the site's design.
vi.mock("@nextlyhq/plugin-sdk/client", () => ({
  useCan: (permission: string) => permission === "update-site-style",
}));

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
    BuilderShell: ({
      inspector,
      topBar,
      topBarCenter,
      topBarEnd,
      children,
      renderSettings,
    }: {
      inspector: React.ReactNode;
      topBar?: React.ReactNode;
      topBarCenter?: React.ReactNode;
      topBarEnd?: React.ReactNode;
      children?: React.ReactNode;
      renderSettings?: (dialog: {
        open: boolean;
        onOpenChange: (open: boolean) => void;
        returnFocus: () => HTMLElement | null;
      }) => React.ReactNode;
    }): React.JSX.Element => (
      <div>
        {/* The real shell renders the host's Settings on every pass, open
            or not, which is where the breakpoint manager now lives. */}
        {renderSettings?.({
          open: false,
          onOpenChange: () => {},
          returnFocus: () => null,
        })}
        {topBar}
        {topBarCenter}
        {topBarEnd}
        {inspector}
        {children}
      </div>
    ),
    InspectorPanel: (props: Record<string, unknown>): React.JSX.Element => {
      seen.inspector = props;
      return <div data-recorder="inspector" />;
    },
    BreakpointManager: nothing,
    BreakpointSwitcher: nothing,
    Canvas: nothing,
    // Recorded, so the shared-style verb the editor hands it can be run.
    BlockKeyboardActions: (props: {
      children?: React.ReactNode;
      sharedStyles?: Record<string, unknown>;
    }): React.JSX.Element => {
      seen.verbs = props.sharedStyles;
      return <>{props.children}</>;
    },
    SaveSharedStyleDialog: (props: Record<string, unknown>): null => {
      seen.saveDialog = props;
      return null;
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
    RepairNotice: nothing,
    LayersPanel: nothing,
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
      document: DOCUMENT,
      // A block selected, so "Save as shared style…" has one to save.
      selectedId: "a",
      selection: { ids: ["a"], primary: "a" },
      apply: () => null,
      applyAll: () => null,
      select: () => {},
      undo: () => {},
      redo: () => {},
      recordStep: (step: (typeof recorded)[number]) => {
        recorded.push(step);
        return () => {
          recorded.splice(recorded.indexOf(step), 1);
        };
      },
      canUndo: false,
      canRedo: false,
      undoDepth: 0,
    }),
    useInlineText: () => ({ onDoubleClick: () => {} }),
  };
});

// Counts the Settings dialog's mounts: its breakpoint section holds its own
// draft, so a style step undone or redone has to mount it afresh.
vi.mock("./editor/settings-dialog", () => ({
  SettingsDialog: (): null => {
    React.useEffect(() => {
      managerMounts += 1;
    }, []);
    return null;
  },
}));

/** Asking the stored style again, as the editor does after a save. */
const refetchStoredStyle = async () => ({ isError: false });
// The stored site style arrives through the editor's one read, the plugin's
// route; that read's request is asserted in `site-style-read.test`.
vi.mock("./site-style-read", () => ({
  useStoredSiteStyle: () => ({ ...storedRead, refetch: refetchStoredStyle }),
}));

vi.mock("@nextlyhq/plugin-sdk/admin", async () => ({
  // The canvas's media read, answering nothing: these cases draw no image.
  // One function for every call, as the admin's own hook keeps it.
  useMediaResolver: (
    read => () =>
      read
  )(() => Promise.resolve(null)),
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
  usePluginClientConfig: () => clientConfig,
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
  useEntryFieldsPanel: () => null,
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
  useDocumentStatus: () => null,
  // The editor registers its restore; nothing here offers one.
  useDocumentRestore: () => undefined,
  /*
   * Reached only on the refusal path, where `site-style-client` asks it to turn
   * a rejection into per-field messages. Answering none exercises the branch
   * that must still refuse when the transport could not describe why.
   */
  validationIssues: () => [],
  useUpdateSingleDocument: () => ({
    mutateAsync: async (value: Record<string, unknown>) => {
      saved.push(value);
      if (saveResult instanceof Error) throw saveResult;
      return saveResult;
    },
    isPending: false,
  }),
}));

const { PageBuilderView } = await import("./editor/PageBuilderView");

/**
 * The blocks field's declaration, as the admin hands it to the view. Typed at
 * the boundary because `FieldConfig` is the closed union of the built-in
 * shapes, and a contributed type such as `blocks` has no arm in it.
 */
const BODY_FIELD = { name: "body", type: "blocks" } as never;

/** The builder's document view, open on the form's `body` field. */
function Host(): React.JSX.Element {
  const { control } = useForm<FieldValues>({
    defaultValues: { body: undefined },
  });
  return (
    <PageBuilderView
      control={control}
      field={BODY_FIELD}
      readOnly={false}
      exit={() => {}}
    />
  );
}

function openEditor(): void {
  render(<Host />);
}

/** Styles as the tests write them: a state, a breakpoint, its values. */
type Styles = { base?: { base?: Record<string, unknown> } };
/** A change the Style tab hands the host: applied to the latest styles. */
type Change = (
  styles: Styles
) => { kind: "write"; styles: Styles } | { kind: "unchanged" };

/** A change that sets one base value, keeping every other. */
const setting =
  (property: string, value: unknown): Change =>
  styles => ({
    kind: "write",
    styles: {
      ...styles,
      base: {
        ...styles.base,
        base: { ...styles.base?.base, [property]: value },
      },
    },
  });

/** What the inspector was handed for the class surface. */
function classProps(): {
  classLibrary?: readonly { id: string; slug: string }[];
  classLibraryAbsence?: "pending" | "failed";
  sharedStyles?: {
    mayChange: boolean;
    writeStyles: (
      classId: string,
      change: Change
    ) => Promise<string | undefined>;
  };
} {
  return (seen.inspector ?? {}) as never;
}

/** A shared style as the builder's save plan makes it from a block. */
const MADE = {
  id: "c-made",
  slug: "call-to-action",
  label: "Call to action",
  orderIndex: 1,
  styles: { base: { base: { color: "#123456" } } },
};

/** Add a shared style through the dialog the save verb raises. */
async function addStyle(entry: Record<string, unknown> = MADE) {
  const verb = seen.verbs as { onSaveAsSharedStyle: () => void };
  act(() => verb.onSaveAsSharedStyle());
  const dialog = seen.saveDialog as {
    onAdd: (entry: unknown) => Promise<string | undefined>;
  };
  let refused: string | undefined;
  await act(async () => {
    refused = await dialog.onAdd(entry);
  });
  return refused;
}

beforeEach(() => {
  seen.inspector = undefined;
  seen.verbs = undefined;
  seen.saveDialog = undefined;
  clientConfig = {};
  storedRead = { data: undefined, isPending: false, error: null };
  saveResult = { success: true };
  saved.length = 0;
  recorded.length = 0;
  managerMounts = 0;
});

afterEach(cleanup);

describe("the library reaching the inspector", () => {
  it("hands it the classes the site has, so the selector can offer them", () => {
    clientConfig = {
      siteStyle: {
        classes: [{ id: "id-hero", slug: "hero", orderIndex: 0, styles: {} }],
      },
    };
    openEditor();

    expect(classProps().classLibrary?.map(c => c.slug)).toEqual(["hero"]);
  });

  it("hands it an EMPTY library, not undefined, when the site has none", () => {
    /*
     * The two are different answers. `undefined` means the read is still in
     * flight and the selector says so; an empty list means the site genuinely
     * has no classes, and the selector must offer to create the first one.
     */
    openEditor();

    expect(classProps().classLibrary).toEqual([]);
  });

  it("hands it undefined while the stored read is still pending", () => {
    storedRead = { data: undefined, isPending: true, error: null };
    openEditor();

    expect(classProps().classLibrary).toBeUndefined();
  });

  it("lends the Style tab the author's right and the style write", () => {
    // Without it a block's shared styles are listed but can never be the
    // Style tab's target, which is how a chain like this ships unreachable.
    openEditor();

    expect(classProps().sharedStyles?.mayChange).toBe(true);
    expect(typeof classProps().sharedStyles?.writeStyles).toBe("function");
  });
});

describe("why the library is absent", () => {
  it("reports a pending read as pending", () => {
    storedRead = { data: undefined, isPending: true, error: null };
    openEditor();

    expect(classProps().classLibrary).toBeUndefined();
    expect(classProps().classLibraryAbsence).toBe("pending");
  });

  it("reports a FAILED read as failed, not as still loading", () => {
    /*
     * A failed read will not finish. Passed as pending, the selector says
     * "loading" for as long as the editor is open — a state the site is not in,
     * with nothing the author can do about it.
     */
    storedRead = { data: undefined, isPending: false, error: new Error("403") };
    openEditor();

    expect(classProps().classLibrary).toBeUndefined();
    expect(classProps().classLibraryAbsence).toBe("failed");
  });

  it("reports a successful empty read as a library, not an absence", () => {
    // The control: a site with no classes has READ them. Treating that as an
    // absence would hide the surface that creates the first one.
    openEditor();

    expect(classProps().classLibrary).toEqual([]);
  });
});

describe("adding a shared style made from a block", () => {
  it("appends the style the save plan made, and stores only the classes", async () => {
    storedRead = {
      data: {
        classes: [{ id: "id-hero", slug: "hero", orderIndex: 0, styles: {} }],
      },
      isPending: false,
      error: null,
    };
    openEditor();

    expect(await addStyle()).toBeUndefined();
    expect(saved).toHaveLength(1);
    // The block is the builder's write, after this one lands.
    expect(Object.keys(saved[0] ?? {})).toEqual(["classes"]);
    expect(saved[0]?.classes).toEqual([
      { id: "id-hero", slug: "hero", orderIndex: 0, styles: {} },
      MADE,
    ]);
  });

  it("refuses a name the queue's library already has, though the dialog's read did not", async () => {
    // A rename to "card" stored after the dialog read the library: the queue
    // holds it, so the add is judged against the queue, not the dialog's read.
    storedRead = {
      data: {
        classes: [
          { id: "id-renamed", slug: "card", orderIndex: 0, styles: {} },
        ],
      },
      isPending: false,
      error: null,
    };
    openEditor();

    const refused = await addStyle({ ...MADE, slug: "card", label: "Card" });

    expect(refused).toBe(
      "“Card” is already a shared style. Choose another name."
    );
    expect(saved).toHaveLength(0);
  });

  it("stores only what differs from the site's own config classes", async () => {
    clientConfig = {
      siteStyle: {
        classes: [
          { id: "id-cfg", slug: "from-config", orderIndex: 0, styles: {} },
        ],
      },
    };
    openEditor();

    await addStyle();

    const written = saved[0]?.classes as { id: string }[];
    expect(written.map(c => c.id)).toEqual(["c-made"]);
  });

  it("refuses to add at all when the library could not be read", async () => {
    // Composing against the config defaults alone would DELETE every stored
    // class rather than add one.
    storedRead = { data: undefined, isPending: false, error: new Error("403") };
    openEditor();

    expect(await addStyle()).toMatch(/could not be read/);
    expect(saved).toHaveLength(0);
  });

  it("reports a refusal instead of claiming the style exists", async () => {
    saveResult = new Error("nope");
    openEditor();

    expect((await addStyle())?.length).toBeGreaterThan(0);
  });

  it("offers the save verb with the library and the author's right", () => {
    openEditor();
    expect(seen.verbs).toMatchObject({ library: [], mayChange: true });
  });
});

describe("writing a shared style's styles while it is the target", () => {
  const card = {
    id: "c-card",
    slug: "card",
    label: "Card",
    locked: undefined,
    orderIndex: 0,
    styles: { base: { base: { color: "#111111" } } },
  };

  it("stores the new styles and keeps every other key of the entry", async () => {
    const { locked: _unlocked, ...stored } = card;
    storedRead = { data: { classes: [stored] }, isPending: false, error: null };
    openEditor();

    const styles = { base: { base: { color: "#222222" } } };
    let refused: string | undefined = "unset";
    await act(async () => {
      refused = await classProps().sharedStyles?.writeStyles(
        "c-card",
        setting("color", "#222222")
      );
    });

    expect(refused).toBeUndefined();
    expect(saved.at(-1)).toEqual({ classes: [{ ...stored, styles }] });
  });

  it("applies each change to what the one before it stored, so two quick edits both survive", async () => {
    const { locked: _unlocked, ...stored } = card;
    storedRead = { data: { classes: [stored] }, isPending: false, error: null };
    openEditor();

    // Both made before the first is stored or read back.
    await act(async () => {
      const write = classProps().sharedStyles?.writeStyles;
      await Promise.all([
        write?.("c-card", setting("opacity", 0.5)),
        write?.("c-card", setting("color", "#222222")),
      ]);
    });

    expect(saved.at(-1)).toEqual({
      classes: [
        {
          ...stored,
          styles: { base: { base: { color: "#222222", opacity: 0.5 } } },
        },
      ],
    });
  });

  it("takes each edit's place in the history when it is made, not when the ones before it are stored", async () => {
    const { locked: _unlocked, ...stored } = card;
    storedRead = { data: { classes: [stored] }, isPending: false, error: null };
    openEditor();

    const write = classProps().sharedStyles?.writeStyles;
    let both: Promise<unknown> = Promise.resolve();
    act(() => {
      both = Promise.all([
        write?.("c-card", setting("opacity", 0.5)),
        write?.("c-card", setting("color", "#222222")),
      ]);
    });
    // Both steps are in the history before either save has answered, so a
    // page edit made now comes after both, as it was made.
    expect(recorded).toHaveLength(2);

    await act(async () => {
      await both;
    });
    expect(recorded).toHaveLength(2);
    expect(saved.at(-1)).toEqual({
      classes: [
        {
          ...stored,
          styles: { base: { base: { color: "#222222", opacity: 0.5 } } },
        },
      ],
    });
  });

  it("refuses a style the site no longer has, and writes nothing", async () => {
    openEditor();
    let refused: string | undefined;
    await act(async () => {
      refused = await classProps().sharedStyles?.writeStyles(
        "gone",
        setting("color", "#222222")
      );
    });
    expect(refused).toBe("This shared style is no longer on the site.");
    expect(saved).toHaveLength(0);
  });

  it("is a step of the editor's history, whose undo writes the old styles back", async () => {
    const { locked: _unlocked, ...stored } = card;
    storedRead = { data: { classes: [stored] }, isPending: false, error: null };
    openEditor();

    await act(async () => {
      await classProps().sharedStyles?.writeStyles(
        "c-card",
        setting("color", "#222222")
      );
    });
    expect(recorded).toHaveLength(1);
    await act(async () => {
      await recorded[0]?.undo();
    });
    expect(saved.at(-1)).toEqual({ classes: [stored] });
  });
});

describe("undoing a shared style added from the editor", () => {
  it("records the creation as a step that writes the library back, and forward again", async () => {
    // The class writer runs in the editor component itself, so this is also
    // the proof that the history reaches it there.
    const hero = { id: "id-hero", slug: "hero", orderIndex: 0, styles: {} };
    storedRead = {
      data: { classes: [hero] },
      isPending: false,
      error: null,
    };
    openEditor();

    await addStyle();
    expect(recorded).toHaveLength(1);
    const created = saved.at(-1);

    let undone: boolean | undefined;
    await act(async () => {
      undone = await recorded[0]?.undo();
    });
    expect(undone).toBe(true);
    expect(saved.at(-1)).toEqual({ classes: [hero] });

    await act(async () => {
      await recorded[0]?.redo();
    });
    expect(saved.at(-1)).toEqual(created);
  });

  it("records nothing when the creation is refused", async () => {
    saveResult = new Error("refused");
    openEditor();
    await addStyle();
    expect(recorded).toEqual([]);
  });

  it("mounts the breakpoint manager afresh when a style step is undone", async () => {
    // It holds its own draft and the save it is waiting on the read for, and
    // would otherwise keep showing the set the undo took back.
    const hero = { id: "id-hero", slug: "hero", orderIndex: 0, styles: {} };
    storedRead = { data: { classes: [hero] }, isPending: false, error: null };
    const { rerender } = render(<Host />);
    await addStyle();
    // The read catches up with the creation.
    storedRead = {
      data: { classes: saved.at(-1)?.classes },
      isPending: false,
      error: null,
    };
    rerender(<Host />);
    const before = managerMounts;
    await act(async () => {
      await recorded[0]?.undo();
    });
    // Not yet: the read still holds the class the undo took back.
    expect(managerMounts).toBe(before);
    storedRead = { data: { classes: [hero] }, isPending: false, error: null };
    rerender(<Host />);
    expect(managerMounts).toBe(before + 1);
  });

  it("refuses a new style while a classes undo is settling, then allows it", async () => {
    // The inspector composes a creation from the library it holds, which
    // still has the class the undo removed until the read catches up.
    const hero = { id: "id-hero", slug: "hero", orderIndex: 0, styles: {} };
    storedRead = { data: { classes: [hero] }, isPending: false, error: null };
    const { rerender } = render(<Host />);
    await addStyle();
    storedRead = {
      data: { classes: saved.at(-1)?.classes },
      isPending: false,
      error: null,
    };
    rerender(<Host />);
    await act(async () => {
      await recorded[0]?.undo();
    });
    const writes = saved.length;
    const refused = await addStyle({
      ...MADE,
      id: "c-another",
      slug: "another",
    });
    expect(refused).toMatch(/being undone or redone/);
    expect(saved).toHaveLength(writes);

    storedRead = { data: { classes: [hero] }, isPending: false, error: null };
    rerender(<Host />);
    const created = await addStyle({
      ...MADE,
      id: "c-another",
      slug: "another",
    });
    expect(created).toBeUndefined();
  });
});
