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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DOCUMENT = { formatVersion: 1, kind: "page", nodes: [] };

/** Props the inspector recorder captured on the most recent render. */
const seen: { inspector: Record<string, unknown> | undefined } = {
  inspector: undefined,
};

/** What `usePluginClientConfig` answers with for the test in hand. */
let clientConfig: Record<string, unknown> | undefined;
/** What the stored site-style read reports, so `pending` can be driven. */
let storedRead: { data: unknown; isPending: boolean; error: unknown };
/** What a save answers, and what it was handed. */
let saveResult: { success: boolean } | Error;
const saved: Array<Record<string, unknown>> = [];

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
      children,
    }: {
      inspector: React.ReactNode;
      topBar?: React.ReactNode;
      children?: React.ReactNode;
    }): React.JSX.Element => (
      <div>
        {topBar}
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
    BlockKeyboardActions: passthrough,
    BlockToolbar: nothing,
    EditorCommandPalette: nothing,
    DropIndicator: nothing,
    InsertPanel: nothing,
    LayersPanel: nothing,
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
      document: DOCUMENT,
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
  };
});

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  usePluginClientConfig: () => clientConfig,
  useDocumentCheckpoint: () => ({ schedule: () => {} }),
  useEntryFieldsPanel: () => null,
  useReportUnsavedWork: () => {},
  useSuppressAdminChrome: () => {},
  useDocumentStatus: () => null,
  /*
   * Reached only on the refusal path, where `site-style-client` asks it to turn
   * a rejection into per-field messages. Answering none exercises the branch
   * that must still refuse when the transport could not describe why.
   */
  validationIssues: () => [],
  useSingleDocument: () => storedRead,
  useUpdateSingleDocument: () => ({
    mutateAsync: async (value: Record<string, unknown>) => {
      saved.push(value);
      if (saveResult instanceof Error) throw saveResult;
      return saveResult;
    },
    isPending: false,
  }),
}));

const { BlocksField } = await import("./BlocksField");

function Host(): React.JSX.Element {
  const { control } = useForm({ defaultValues: { body: undefined } });
  return <BlocksField name="body" control={control} />;
}

function openEditor(): void {
  render(<Host />);
  fireEvent.click(screen.getByRole("button", { name: "Edit blocks" }));
}

/** What the inspector was handed for the class surface. */
function classProps(): {
  classLibrary?: readonly { id: string; slug: string }[];
  onCreateClass?: (
    slug: string
  ) => Promise<{ ok: true; classId: string } | { ok: false; reason: string }>;
} {
  return (seen.inspector ?? {}) as never;
}

beforeEach(() => {
  seen.inspector = undefined;
  clientConfig = {};
  storedRead = { data: undefined, isPending: false, error: null };
  saveResult = { success: true };
  saved.length = 0;
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

  it("opts the surface in by supplying the create callback", () => {
    // Without it the inspector renders no class surface at all, which is how
    // this chain shipped unreachable once already.
    openEditor();

    expect(typeof classProps().onCreateClass).toBe("function");
  });
});

describe("creating a class", () => {
  it("writes the classes section and answers with the new id", async () => {
    clientConfig = {
      siteStyle: {
        classes: [{ id: "id-hero", slug: "hero", orderIndex: 0, styles: {} }],
      },
    };
    openEditor();

    const created = await classProps().onCreateClass!("call-to-action");

    expect(created.ok).toBe(true);
    expect(saved).toHaveLength(1);
    const written = saved[0]?.classes as { id: string; slug: string }[];
    expect(written.map(c => c.slug)).toEqual(["hero", "call-to-action"]);
    // The id it reports is the id it stored, or the caller applies a class the
    // library does not contain.
    expect(created.ok && created.classId).toBe(written[1]?.id);
  });

  it("gives the new class a fresh id rather than seeding it from the slug", () => {
    // `NamedClass` keeps id and slug apart so a rename cannot orphan the
    // documents referencing it; an id derived from the name would be a fossil
    // of whatever the class was called first.
    openEditor();

    return classProps().onCreateClass!("call-to-action").then(() => {
      const written = saved[0]?.classes as { id: string; slug: string }[];
      expect(written[0]?.id).not.toBe("call-to-action");
      expect(written[0]?.id.length).toBeGreaterThan(10);
    });
  });

  it("orders it past every existing class, so applying it wins", async () => {
    clientConfig = {
      siteStyle: {
        classes: [
          { id: "a", slug: "one", orderIndex: 0, styles: {} },
          { id: "b", slug: "two", orderIndex: 7, styles: {} },
        ],
      },
    };
    openEditor();

    await classProps().onCreateClass!("three");

    const written = saved[0]?.classes as { orderIndex: number }[];
    expect(written[2]?.orderIndex).toBe(8);
  });

  it("does NOT apply it to a node — that is the inspector's write", async () => {
    // Two documents. Returning the id keeps the application on the one path
    // that enforces the per-node bound.
    openEditor();

    await classProps().onCreateClass!("call-to-action");

    expect(saved).toHaveLength(1);
    expect(Object.keys(saved[0] ?? {})).toEqual(["classes"]);
  });

  it("reports a refusal instead of claiming the class exists", async () => {
    saveResult = new Error("nope");
    openEditor();

    const created = await classProps().onCreateClass!("call-to-action");

    expect(created.ok).toBe(false);
    expect(created.ok === false && created.reason.length).toBeGreaterThan(0);
  });
});
