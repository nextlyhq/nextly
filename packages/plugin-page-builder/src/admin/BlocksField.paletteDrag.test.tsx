// @vitest-environment jsdom

/**
 * The palette drag reaching the engine — which is wiring, and only wiring.
 *
 * `insert-drag.test.tsx` in the builder asserts the GESTURE: what a drag
 * commits, when, and what ends it. None of that runs unless this component
 * hands the panel a way to start one and hands the drag the canvas to measure
 * against, and every one of those assertions stays green while both props are
 * absent — the engine is simply never reached, and no user can drag anything.
 *
 * So what is asserted here is the composition: that the ref the drag resolves
 * its drop against is the SAME ref the rendered canvas publishes, and that the
 * panel is given the drag's own starter. Identity rather than presence, because
 * two different refs would satisfy "both are defined" while the drag measured
 * against a canvas that is not on screen.
 *
 * @module admin/BlocksField.paletteDrag.test
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_BUILDER_ACTION } from "./PageBuilderCard";
import {
  CAPABILITY_ROUTE_PATH,
  COMPONENT_LIBRARY_ROUTE_PATH,
  LIBRARY_ROUTE_PATH,
} from "../library-contract";

/**
 * What the library route answers, for the one case that cares.
 *
 * `undefined` is the ordinary state here — a site with no saved patterns — and
 * every other case in this file was written against it.
 */
let libraryAnswer: { items: unknown[]; meta: unknown } | undefined;

/** What the capability route answers. Mutable so a case can withhold the grant. */
let capabilityAnswer: { mayCreate: boolean } | undefined;

/** Which document the field is inside, or none. */
let documentIdentity: {
  kind: "collection" | "single";
  slug: string;
  documentId?: string;
} | null = null;

/**
 * What the component route answers.
 *
 * Its own answer rather than the pattern library's: the two routes carry
 * different rows under the same envelope, and a mock handing the pattern rows
 * to the component read would put pattern documents in the definitions map.
 */
let componentAnswer: { items: unknown[]; meta: unknown } | undefined;
/** What the component read reports beside its answer: a failed refresh keeps the answer. */
let componentError: Error | null = null;

/**
 * Which panel the shell stub asks for.
 *
 * The real shell draws one at a time and calls `renderPanel` only for that one,
 * so this is how a case says "the author is looking at something else".
 */
let shownPanel = "insert";

/** How many times the whole LIBRARY was asked for — the panel's read. */
let routeReads = 0;

/** How many times the COMPONENT tier alone was asked for — the editor's read. */
let componentReads = 0;

/** How many times the capability route was asked for. */
let capabilityReads = 0;

/**
 * The paths the mock discriminates on, hoisted so the factory below can see
 * them, and CHECKED against the real contract in a test — a literal here that
 * drifted from the route would silently stop counting, and both assertions
 * about laziness would then pass against a mock answering nothing.
 */
const paths = vi.hoisted(() => ({
  library: "/library",
  components: "/library/components",
  capability: "/capability",
}));

/** Props the recorders captured on the most recent render. */
const seen: {
  inspector: Record<string, unknown> | undefined;
  canvas: Record<string, unknown> | undefined;
  breakpoints: Record<string, unknown> | undefined;
  insertPanel: Record<string, unknown> | undefined;
  dragOptions: Record<string, unknown> | undefined;
  toolbar: Record<string, unknown> | undefined;
  spacing: Record<string, unknown> | undefined;
} = {
  inspector: undefined,
  canvas: undefined,
  breakpoints: undefined,
  insertPanel: undefined,
  dragOptions: undefined,
  toolbar: undefined,
  spacing: undefined,
};

/** What the recorded drag reports as in flight, per test. */
let draggingBlockName: string | null = null;

/** The starter the recorded drag hands back, for an identity assertion. */
const beginInsertDrag = (): void => {};

/** What `usePluginClientConfig` answers with for the test in hand. */
let clientConfig: Record<string, unknown> | undefined;

/** What the stored-style read answers with for the test in hand. */
let siteStyleRead: { data: unknown; isPending: boolean; error: Error | null } =
  {
    data: undefined,
    isPending: false,
    error: null,
  };

vi.mock("@nextlyhq/builder/shell", async importOriginal => {
  /*
   * The real module SPREAD, with only the surfaces this file drives replaced.
   * A closed object literal here answers `undefined` for every export it does
   * not list, so adding one to the shell breaks these tests and leaves the
   * builder's own suite green — a failure that reads as a fault in this file
   * rather than as a stale list. Measured: the real module imports cleanly
   * under vitest and the overrides below win over the spread.
   */
  const real = await importOriginal<Record<string, unknown>>();
  const record =
    (key: "inspector" | "canvas" | "insertPanel" | "toolbar" | "spacing") =>
    (props: Record<string, unknown>): React.JSX.Element => {
      seen[key] = props;
      return <div data-recorder={key} />;
    };
  const nothing = (): null => null;
  // The canvas sits inside this one, so it has to pass its children through.
  const passthrough = ({
    children,
  }: {
    children?: React.ReactNode;
  }): React.JSX.Element => <>{children}</>;
  return {
    ...real,
    // Renders the inspector slot and its CHILDREN, because the canvas is a
    // child of the shell rather than one of its slots — a stub dropping them
    // would leave the canvas unrendered and its assertion passing on absence.
    BuilderShell: ({
      inspector,
      topBar,
      children,
      renderPanel,
    }: {
      inspector: React.ReactNode;
      topBar?: React.ReactNode;
      children?: React.ReactNode;
      renderPanel?: (panel: string) => React.ReactNode;
    }): React.JSX.Element => (
      <div>
        {/*
         * The top bar is rendered for the same reason the children are: the
         * breakpoint manager lives there, and a stub that dropped the slot
         * would leave its assertions passing on absence.
         */}
        {topBar}
        {inspector}
        {/*
         * The real shell draws one panel at a time and this mock draws none,
         * so the insert panel is asked for explicitly. Without it the recorder
         * never mounts and "the panel was given a starter" would be an
         * assertion about a component that was never rendered.
         */}
        {renderPanel?.(shownPanel)}
        {children}
      </div>
    ),
    BreakpointManager: record("breakpoints"),
    InspectorPanel: record("inspector"),
    Canvas: (props: Record<string, unknown>): React.JSX.Element => {
      seen.canvas = props;
      /*
       * The overlay is RENDERED, not dropped. The toolbar and the spacing
       * bands are passed to the canvas as overlay content, so a recorder that
       * returned a bare div would leave them unmounted — and every assertion
       * about whether they are hidden would be an assertion about `undefined`.
       */
      return (
        <div data-recorder="canvas">{props.overlay as React.ReactNode}</div>
      );
    },
    BlockKeyboardActions: passthrough,
    /*
     * Passed THROUGH, not stubbed to nothing: the canvas renders inside it, so
     * a stub would take the recorder below out of the tree along with it. The
     * real one reads the verbs context, which the passthrough above does not
     * provide.
     */
    BlockContextMenu: passthrough,
    BlockToolbar: record("toolbar"),
    EditorCommandPalette: nothing,
    DropIndicator: nothing,
    InsertPanel: record("insertPanel"),
    LayersPanel: nothing,
    OnboardingChecklist: nothing,
    SelectionBreadcrumb: nothing,
    SpacingOverlay: record("spacing"),
    useBuilderChecklist: () => ({
      visible: false,
      steps: [],
      dismiss: () => {},
    }),
    useCanvasDrag: (options: Record<string, unknown>) => {
      seen.dragOptions = options;
      return {
        handlers: {},
        target: null,
        beginInsertDrag,
        // Null throughout a palette drag, deliberately: the block has no node
        // until the release makes one. That is exactly the state the gates
        // below must still treat as "a drag is happening".
        draggingId: null,
        draggingBlockName,
      };
    },
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
  };
});

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  /*
   * Never awaited by these cases: the loader is reached only when an author
   * double-clicks a passage, and none of them do. Present because the mock
   * REPLACES the module wholesale, so an export the subject imports and this
   * omits is a missing-export error rather than an unused stub.
   */
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  usePluginClientConfig: () => clientConfig,
  // Which document the field sits in. Mutable so one case can put the
  // field inside a component's own row.
  useDocumentIdentity: () => documentIdentity,
  /*
   * The library read. Absent here rather than stubbed with patterns, because
   * these cases are about other surfaces and an offered pattern would change
   * what the palette contains. `pending: false` says the read ANSWERED with
   * nothing, which is the site with an empty library — the state every one of
   * these cases was written against.
   */
  // The library read. Mutable so one case can put a pattern in it: what the
  // panel is GIVEN is this file's subject, and the tier was unreachable for as
  // long as the answer never reached the prop.
  // Discriminated BY PATH. The editor now makes two different reads — the
  // library when the insert panel opens, and the capability eagerly on mount —
  // and a mock that counted both as one made "does not read the library" fail
  // for a read of something else entirely.
  usePluginRoute: (args: { path: string }) => {
    if (args.path === paths.capability) {
      capabilityReads += 1;
      return {
        data: capabilityAnswer,
        pending: false,
        error: null,
        refetch: () => {},
      };
    }
    // Two readers share the library route and differ in WHEN they read: the
    // panel reads the whole library only while it is on screen, and the editor
    // reads the component tier on every mount so the canvas can draw an
    // instance. Counted apart, so a case about the one does not see the other.
    if (args.path === paths.components) {
      componentReads += 1;
      return {
        data: componentAnswer,
        pending: false,
        error: componentError,
        refetch: () => {},
      };
    }
    routeReads += 1;
    return {
      data: libraryAnswer,
      pending: false,
      error: null,
      refetch: () => {},
    };
  },
  useDocumentCheckpoint: () => ({ record: () => {}, clear: () => {} }),
  useEntryFieldsPanel: () => null,
  useReportUnsavedWork: () => {},
  useSuppressAdminChrome: () => {},
  // `null` is a real answer the pill handles — "no status has been persisted",
  // which is what a create form and a preview both look like — so this mounts
  // the top bar without putting a second subject in the assertions below.
  useDocumentStatus: () => null,
  // The stored style tier. Answered as "nothing stored yet" here, because what
  // this file asserts is which props reach the two enforcing surfaces — the
  // merge of stored over defaults is `site-style-client`'s own question and has
  // its own coverage. Standing a real query client up here would put a second
  // subject in every assertion below.
  useSingleDocument: () => siteStyleRead,
  useUpdateSingleDocument: () => ({
    mutateAsync: async () => ({ success: true }),
    isPending: false,
  }),
}));

// Imported after the mocks, which is what makes them take effect: the module
// resolves the shell at import time, and a specifier already bound to the real
// module cannot be replaced afterwards.
const { BlocksField } = await import("./BlocksField");

/** A form around the field, since it reads its value through a form control. */
function Host({
  document,
}: {
  document?: BlockDocument;
} = {}): React.JSX.Element {
  const { control } = useForm({ defaultValues: { body: document } });
  return <BlocksField name="body" control={control} />;
}

/** A component's own content, as its content field holds it. */
function componentDocument(): BlockDocument {
  return {
    formatVersion: 1,
    kind: "component",
    nodes: [],
  } as unknown as BlockDocument;
}

/** Mount the field and open the editor, which is where the two surfaces live. */
function openEditor(): void {
  render(<Host />);
  fireEvent.click(screen.getByRole("button", { name: OPEN_BUILDER_ACTION }));
}

beforeEach(() => {
  seen.insertPanel = undefined;
  seen.dragOptions = undefined;
  seen.canvas = undefined;
  seen.toolbar = undefined;
  seen.spacing = undefined;
  draggingBlockName = null;
  clientConfig = undefined;
  siteStyleRead = { data: undefined, isPending: false, error: null };
});

afterEach(() => {
  cleanup();
  // A leaked answer would make the next case's palette offer a pattern it was
  // not written for.
  libraryAnswer = undefined;
  componentAnswer = undefined;
  componentError = null;
  documentIdentity = null;
  shownPanel = "insert";
  routeReads = 0;
  componentReads = 0;
  capabilityReads = 0;
  capabilityAnswer = { mayCreate: true };
});

describe("what makes a palette drag reachable at all", () => {
  it("gives the drag the very canvas it renders", () => {
    openEditor();

    // Population first: if the recorders caught nothing, every assertion below
    // would be about `undefined` and would read as a passing wiring check.
    expect(seen.dragOptions).toBeDefined();
    expect(seen.canvas).toBeDefined();

    const forDrag = seen.dragOptions?.canvasRoot;
    expect(forDrag).toBeDefined();
    // Identity, not presence. Two separate refs would satisfy "both defined"
    // while the drag resolved its drop against a canvas nobody is looking at.
    expect(seen.canvas?.rootRef).toBe(forDrag);
  });

  it("hides the canvas chrome during a palette drag, which has no node id", () => {
    // The gates used to read `draggingId`, which is null for the whole of a
    // palette drag — so the toolbar and the spacing bands stayed up while an
    // author dragged a new block in. The toolbar sits above the drop
    // indicator, so it covers the position being aimed at.
    draggingBlockName = "core/heading";
    openEditor();

    expect(seen.toolbar).toBeDefined();
    expect(seen.spacing).toBeDefined();
    expect(seen.toolbar?.hidden).toBe(true);
    expect(seen.spacing?.hidden).toBe(true);
  });

  it("leaves the chrome up when nothing is being dragged", () => {
    // The must-differ control. Gates wired to a constant `true` would satisfy
    // the case above while hiding the toolbar permanently.
    draggingBlockName = null;
    openEditor();

    expect(seen.toolbar?.hidden).toBe(false);
    expect(seen.spacing?.hidden).toBe(false);
  });

  it("gives the panel the drag's own starter", () => {
    openEditor();

    expect(seen.insertPanel).toBeDefined();
    // The same function the drag returned, so a row's press reaches THIS
    // gesture rather than some other callback that merely has the right name.
    expect(seen.insertPanel?.beginInsertDrag).toBe(beginInsertDrag);
  });
});

describe("what makes the saved pattern tier reachable at all", () => {
  it("hands the panel the patterns the library answered with", () => {
    // The panel has accepted a `patterns` prop since the tier landed, and
    // nothing supplied one — so an author could save a pattern and never see it
    // again. Every other assertion in this file stays green with the prop
    // absent, because the palette still draws its blocks.
    //
    // Asserted as IDENTITY with what the read returned, not as "some patterns
    // arrived": a component that built its own list would satisfy presence.
    const items = [
      {
        id: "hero",
        title: "Hero",
        granularity: "section",
        content: { formatVersion: 1, kind: "pattern", nodes: [] },
      },
    ];
    libraryAnswer = { items, meta: { count: 1, truncated: false } };

    openEditor();

    // Population first: an assertion about `undefined` reads as a passing
    // wiring check.
    expect(seen.insertPanel).toBeDefined();
    expect(seen.insertPanel?.patterns).toBe(items);
  });

  it("does not offer a PAGE pattern for insertion", () => {
    // A full-page pattern is a way to start a page, not something to place
    // after the selected block. `SavedPattern` carries no granularity, so the
    // panel cannot tell one apart — it would be offered for insertion inside
    // the page it is meant to be.
    const section = {
      id: "hero",
      title: "Hero",
      granularity: "section",
      content: { formatVersion: 1, kind: "pattern", nodes: [] },
    };
    const whole = {
      id: "landing",
      title: "Landing",
      granularity: "page",
      content: { formatVersion: 1, kind: "pattern", nodes: [] },
    };
    libraryAnswer = {
      items: [section, whole],
      meta: { count: 2, truncated: false },
    };

    openEditor();

    const offered = seen.insertPanel?.patterns as { id: string }[] | undefined;
    expect(offered?.map(p => p.id)).toEqual(["hero"]);
  });

  it("gives it an empty list, not undefined, before the read answers", () => {
    // The panel builds its catalogue in a memo keyed on this prop, running the
    // planner's preflight over every pattern in the library. A fresh `[]` each
    // render is a new identity, so that whole catalogue would rebuild on every
    // keystroke of the panel's own filter.
    openEditor();
    const first = seen.insertPanel?.patterns;
    cleanup();
    openEditor();

    expect(first).toEqual([]);
    expect(seen.insertPanel?.patterns).toBe(first);
  });
});

describe("what the editor reads before anyone asks for it", () => {
  it("discriminates the two routes by the paths the plugin actually declares", () => {
    // The control for both assertions below. If either literal drifted from the
    // contract the mock would answer the wrong shape for both reads, and a
    // counter that never incremented would report perfect laziness.
    expect(paths.library).toBe(LIBRARY_ROUTE_PATH);
    expect(paths.components).toBe(COMPONENT_LIBRARY_ROUTE_PATH);
    expect(paths.capability).toBe(CAPABILITY_ROUTE_PATH);
  });

  it("asks what the author may do EAGERLY, before any panel is opened", () => {
    // The verb it gates is drawn by the toolbar, the context menu and the
    // palette, all of which exist before the insert panel does — so an answer
    // deferred to the panel arrives after the control it describes.
    shownPanel = "layers";

    openEditor();

    expect(capabilityReads).toBeGreaterThan(0);
  });

  it("does not read the library while another panel is open", () => {
    // Reading in the editor's own body fetched every saved pattern document on
    // every editor mount — for authors who open Layers, or Tokens, or no panel
    // at all, and never visit Insert. The library is the panel's data, so the
    // panel's mount is when it is asked for.
    shownPanel = "layers";

    openEditor();

    expect(routeReads).toBe(0);
  });

  it("reads the COMPONENT tier on mount whichever panel is open", () => {
    // The canvas needs definitions to draw an instance at all, and a page can
    // hold instances before any panel is opened. This is the one library read
    // that does not wait for the panel — and it asks for the component tier
    // alone, so it does not drag the pattern tier along on every editor open.
    shownPanel = "layers";

    openEditor();

    expect(componentReads).toBeGreaterThan(0);
    expect(routeReads).toBe(0);
  });

  it("reads it once the insert panel is the one on screen", () => {
    // The control. Without it the assertion above is satisfied by a hook that
    // never reads at all, which is the tier being unreachable again.
    shownPanel = "insert";

    openEditor();

    expect(routeReads).toBeGreaterThan(0);
  });

  it("hands the canvas and the panel ONE definitions map, and the panel the rows and the cut", () => {
    // Three props from one read, asserted by identity where identity is the
    // point: the map the panel resolves a tile's roots through must be the
    // map the canvas draws with, or the two can judge one definition from two
    // different documents. The rows are what the tiles are built from, and
    // the cut is what the panel says beside them.
    const definition = {
      formatVersion: 1,
      kind: "component",
      nodes: [{ id: "d1", type: "core/box", version: 1, props: {} }],
    };
    const items = [{ id: "header", title: "Header", document: definition }];
    componentAnswer = { items, meta: { count: 1, truncated: true } };
    libraryAnswer = { items: [], meta: { count: 0, truncated: false } };

    openEditor();

    // Population first, once: every recorder must have rendered, or the
    // identity assertions below would be comparing `undefined` to `undefined`.
    const canvas = recorded("canvas");
    const panel = recorded("insertPanel");
    const inspector = recorded("inspector");
    const render = canvas.render as {
      definitions: Map<string, unknown>;
      limits: unknown;
    };
    expect(render.definitions.get("header")).toBe(definition);
    expect(panel.componentDefinitions).toBe(render.definitions);
    expect(panel.components).toBe(items);
    expect(panel.library).toMatchObject({
      patterns: "ready",
      components: "cut",
    });
    // And the caps the canvas resolves under, so a tile is judged under the
    // same bounds the instance is drawn under.
    expect(panel.documentLimits).toBe(render.limits);
    // And the inspector reads the SAME map, so a selected instance's rows come
    // from the document the canvas draws, with the rows that carry its title.
    const library = inspector.componentLibrary as {
      definitions: unknown;
      components: unknown;
    };
    expect(library.definitions).toBe(render.definitions);
    expect(library.components).toBe(items);
  });
});

describe("what the panel is told of a read that failed to refresh", () => {
  it("names the tier stale, ahead of the cut its last answer carried", () => {
    // The tiles stand — they are the last answer — so the panel is told they
    // may be out of date rather than that none are offered. Ahead of the
    // cut, because the cut describes the answer the retry replaces: a
    // library reloaded whole is reported cut again.
    const definition = {
      formatVersion: 1,
      kind: "component",
      nodes: [{ id: "d1", type: "core/box", version: 1, props: {} }],
    };
    componentAnswer = {
      items: [{ id: "header", title: "Header", document: definition }],
      meta: { count: 1, truncated: true },
    };
    componentError = new Error("Forbidden");
    libraryAnswer = { items: [], meta: { count: 0, truncated: false } };

    openEditor();

    const panel = recorded("insertPanel");
    expect(panel.library).toMatchObject({
      patterns: "ready",
      components: "stale",
    });
    expect((panel.componentDefinitions as Map<string, unknown>).size).toBe(1);
  });
});

describe("what a component's own content field may offer", () => {
  const definition = {
    formatVersion: 1,
    kind: "component",
    nodes: [{ id: "d1", type: "core/box", version: 1, props: {} }],
  };
  const rows = [
    { id: "header", title: "Header", document: definition },
    { id: "footer", title: "Footer", document: definition },
  ];

  it("leaves out the definition the field is editing, and keeps the map whole", () => {
    // Placed, an instance of the definition inside itself is a cycle the
    // resolver draws as a placeholder; the offer is where the field knows
    // which row it is inside. The canvas still resolves every OTHER instance
    // against the whole map.
    componentAnswer = { items: rows, meta: { count: 2, truncated: false } };
    documentIdentity = {
      kind: "collection",
      slug: "components",
      documentId: "header",
    };
    render(<Host document={componentDocument()} />);
    fireEvent.click(screen.getByRole("button", { name: OPEN_BUILDER_ACTION }));

    const panel = recorded("insertPanel");
    expect((panel.components as { id: string }[]).map(c => c.id)).toEqual([
      "footer",
    ]);
    const canvas = recorded("canvas");
    expect(
      (canvas.render as { definitions: Map<string, unknown> }).definitions.has(
        "header"
      )
    ).toBe(true);
  });

  it("leaves out every component that reaches the one being edited, however many steps away", () => {
    // The direct case above is the shortest cycle, not the only one. Editing
    // A while B holds an instance of A, placing B makes A → B → A; while C
    // holds B, placing C makes A → C → B → A. Neither is visible against the
    // saved map until A is saved, and then every page placing any of them
    // draws a placeholder. Judged by what drawing each candidate READS
    // through the canvas's own lookup, so the offer and the canvas agree on
    // what a definition reaches.
    const instanceOf = (componentId: string, id: string) => ({
      id,
      type: "nextly/component-instance",
      version: 1,
      props: { componentId },
    });
    const holding = (node: unknown) => ({
      formatVersion: 1,
      kind: "component",
      nodes: [node],
    });
    const library = [
      { id: "a", title: "A", document: definition },
      { id: "b", title: "B", document: holding(instanceOf("a", "b-a")) },
      { id: "c", title: "C", document: holding(instanceOf("b", "c-b")) },
      { id: "d", title: "D", document: holding(instanceOf("footer", "d-f")) },
      { id: "footer", title: "Footer", document: definition },
    ];
    componentAnswer = { items: library, meta: { count: 5, truncated: false } };
    documentIdentity = {
      kind: "collection",
      slug: "components",
      documentId: "a",
    };
    render(<Host document={componentDocument()} />);
    fireEvent.click(screen.getByRole("button", { name: OPEN_BUILDER_ACTION }));

    const panel = recorded("insertPanel");
    expect((panel.components as { id: string }[]).map(c => c.id)).toEqual([
      "d",
      "footer",
    ]);
  });

  it("offers every component to a PAGE's field, whatever the page's id", () => {
    // The control, and the rule's second half: a page is never inside a
    // component, however the ids happen to fall.
    componentAnswer = { items: rows, meta: { count: 2, truncated: false } };
    documentIdentity = {
      kind: "collection",
      slug: "pages",
      documentId: "header",
    };

    openEditor();

    const panel = recorded("insertPanel");
    expect(panel.components).toBe(rows);
  });

  it("offers every component to a component's field on a create form, which names no row", () => {
    componentAnswer = { items: rows, meta: { count: 2, truncated: false } };
    documentIdentity = { kind: "collection", slug: "components" };
    render(<Host document={componentDocument()} />);
    fireEvent.click(screen.getByRole("button", { name: OPEN_BUILDER_ACTION }));

    expect(recorded("insertPanel").components).toBe(rows);
  });
});

/** A recorder's props, asserted present so a missing render cannot read as equal. */
function recorded(
  key: "canvas" | "insertPanel" | "inspector"
): Record<string, unknown> {
  const props = seen[key];
  if (props === undefined) throw new Error(`the ${key} never rendered`);
  return props;
}
