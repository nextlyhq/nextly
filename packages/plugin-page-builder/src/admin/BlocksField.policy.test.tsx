// @vitest-environment jsdom

/**
 * The host-fetch policy reaching the two surfaces that enforce it.
 *
 * `host-policy.test.ts` asserts the derivation: that the plugin's published
 * patterns read back into a predicate answering as the engine does. What is
 * only true HERE is the wiring — that the derived values are actually handed to
 * the canvas and to the inspector. The derivation can be perfect while both
 * props are absent, and then the canvas draws media the published page drops
 * and the Style tab accepts a URL the compiler refuses.
 *
 * The builder shell and the admin hooks are replaced with recorders rather than
 * rendered. What is under test is which props this component passes, so
 * observing the arguments the real call receives is the assertion; rendering a
 * canvas would add a tree whose behaviour belongs to another package's tests.
 *
 * @module admin/BlocksField.policy.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_BUILDER_ACTION } from "./PageBuilderCard";

/** Props the recorders captured on the most recent render. */
const seen: {
  inspector: Record<string, unknown> | undefined;
  canvas: Record<string, unknown> | undefined;
  breakpoints: Record<string, unknown> | undefined;
} = { inspector: undefined, canvas: undefined, breakpoints: undefined };

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
    (key: "inspector" | "canvas") =>
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
    }: {
      inspector: React.ReactNode;
      topBar?: React.ReactNode;
      children?: React.ReactNode;
    }): React.JSX.Element => (
      <div>
        {/*
         * The top bar is rendered for the same reason the children are: the
         * breakpoint manager lives there, and a stub that dropped the slot
         * would leave its assertions passing on absence.
         */}
        {topBar}
        {inspector}
        {children}
      </div>
    ),
    BreakpointManager: record("breakpoints"),
    InspectorPanel: record("inspector"),
    Canvas: record("canvas"),
    BlockKeyboardActions: passthrough,
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
function Host(): React.JSX.Element {
  const { control } = useForm({ defaultValues: { body: undefined } });
  return <BlocksField name="body" control={control} />;
}

/** Mount the field and open the editor, which is where the two surfaces live. */
function openEditor(): void {
  render(<Host />);
  fireEvent.click(screen.getByRole("button", { name: OPEN_BUILDER_ACTION }));
}

beforeEach(() => {
  seen.inspector = undefined;
  seen.canvas = undefined;
  seen.breakpoints = undefined;
  clientConfig = undefined;
  siteStyleRead = { data: undefined, isPending: false, error: null };
});

afterEach(() => {
  cleanup();
});

describe("what the editor hands its two enforcing surfaces", () => {
  it("gives the canvas the site's patterns as its host policy", () => {
    clientConfig = { remotePatterns: [{ hostname: "cdn.example" }] };

    openEditor();

    // Reached through `render`, which is what `Canvas` forwards to
    // `PageRenderer`. Absent, the image and embed boundaries there read
    // `patterns === undefined` as permissive.
    expect(seen.canvas?.render).toMatchObject({
      hostPolicy: { remotePatterns: [{ hostname: "cdn.example" }] },
    });
  });

  it("gives the inspector a policy that refuses a disallowed host", () => {
    clientConfig = { remotePatterns: [{ hostname: "cdn.example" }] };

    openEditor();

    // Asserted by asking the predicate rather than by comparing it to a
    // function: what matters is the verdict it produces, and a reference
    // comparison would pass on a policy derived from the wrong patterns.
    const policy = seen.inspector?.policy as
      | { mayFetchUrl?: (url: string) => boolean }
      | undefined;
    expect(policy?.mayFetchUrl?.("https://cdn.example/a.png")).toBe(true);
    expect(policy?.mayFetchUrl?.("https://evil.example/a.png")).toBe(false);
  });

  it("asks nothing of either surface when the host declared no patterns", () => {
    // A site that configured nothing keeps rendering every remote image it
    // renders today. This is the assertion that would fail if an absent list
    // narrowed to an empty one, which is a closed policy rather than no policy.
    clientConfig = { checklist: false };

    openEditor();

    expect(seen.canvas?.render).not.toHaveProperty("hostPolicy");
    const policy = seen.inspector?.policy as
      | { mayFetchUrl?: (url: string) => boolean }
      | undefined;
    expect(policy?.mayFetchUrl).toBeUndefined();
  });
});

describe("what the canvas waits for", () => {
  it("holds the canvas back while the stored style is still arriving", () => {
    // The defaults `useSiteStyle` answers with meanwhile are a real design, not
    // a placeholder — so a canvas mounted on them looks finished and is wrong
    // wherever an admin overrode something. An author would watch the page
    // re-lay-out, and could drag against a design the site does not have.
    siteStyleRead = { data: undefined, isPending: true, error: null };

    openEditor();

    expect(seen.canvas).toBeUndefined();
    expect(
      document.querySelector('[data-canvas-state="loading"]')
    ).not.toBeNull();
  });

  it("mounts the canvas once the read has answered", () => {
    // The control. Without it a build that never mounted the canvas at all
    // would pass the test above.
    siteStyleRead = { data: undefined, isPending: false, error: null };

    openEditor();

    expect(seen.canvas).toBeDefined();
    expect(document.querySelector('[data-canvas-state="loading"]')).toBeNull();
  });
});

describe("when the stored style cannot be read at all", () => {
  it("holds the canvas back and says so, rather than mounting on defaults", () => {
    // The failure path into the same defect the pending gate exists to stop.
    // A read that exhausts its retry — a network fault, or a 403 for an editor
    // without `read-site-style` — leaves `pending` false while the merged value
    // falls back to the config defaults. Gating on `pending` alone would mount a
    // finished-looking canvas over a stored tier nobody has read.
    siteStyleRead = {
      data: undefined,
      isPending: false,
      error: new Error("Forbidden"),
    };

    openEditor();

    expect(seen.canvas).toBeUndefined();
    expect(
      document.querySelector('[data-canvas-state="failed"]')
    ).not.toBeNull();
  });

  it("tells a FAILED read apart from a pending one", () => {
    // Two different sentences for two different states: "still coming" and
    // "will not come". Collapsing them would leave an author watching a
    // loading message that never resolves.
    siteStyleRead = { data: undefined, isPending: true, error: null };
    openEditor();

    expect(
      document.querySelector('[data-canvas-state="loading"]')
    ).not.toBeNull();
    expect(document.querySelector('[data-canvas-state="failed"]')).toBeNull();
  });
});

describe("what the token picker waits for", () => {
  /**
   * A site whose config defines a colour token.
   *
   * Required by every case here, including the negatives: with no token defined
   * anywhere, `tokens` is undefined whatever the gate does, and the two
   * withholding assertions would pass on the fixture rather than on the gate.
   * Measured — the control below failed until this was supplied.
   */
  beforeEach(() => {
    clientConfig = {
      siteStyle: {
        tokens: {
          tokens: [
            { name: "color.ink", kind: "color", values: { light: "#111111" } },
          ],
        },
      },
    };
  });

  it("offers no tokens while the stored style is still arriving", () => {
    // The same reasoning that holds the canvas back, one surface over. The
    // defaults `useSiteStyle` answers with meanwhile are a real design, so a
    // picker fed from them offers a token by a name and colour the site may
    // have overridden — and the identity an author chose then resolves to
    // something else on the published page.
    siteStyleRead = { data: undefined, isPending: true, error: null };

    openEditor();

    expect(seen.inspector).toBeDefined();
    expect(seen.inspector?.tokens).toBeUndefined();
  });

  it("offers no tokens when the stored style cannot be read at all", () => {
    // `pending` is false on this path while the merged value falls back to the
    // config defaults, so gating on `pending` alone would hand the picker a
    // tier nobody has read.
    siteStyleRead = {
      data: undefined,
      isPending: false,
      error: new Error("Forbidden"),
    };

    openEditor();

    expect(seen.inspector?.tokens).toBeUndefined();
  });

  it("offers the merged tokens once the read has answered", () => {
    // The control. Without it a build that never passed tokens at all would
    // pass both tests above.
    siteStyleRead = { data: undefined, isPending: false, error: null };

    openEditor();

    expect(seen.inspector?.tokens).toBeDefined();
  });
});

describe("the shell mock keeps up with the shell", () => {
  it("still provides every export this file's subject imports", async () => {
    /*
     * The stale-list failure, pinned. A `vi.mock` factory returning a closed
     * object literal answers `undefined` for every export it does not name — so
     * a surface added to the shell and imported by `BlocksField` arrives here
     * as `undefined`, and the component throws only once something renders it.
     * The break is then invisible in the builder's own suite, which passes, and
     * reads in this package as a fault in the subject rather than as a mock
     * that stopped covering it.
     *
     * Asserted over the names `BlocksField` actually imports rather than over
     * the whole module, because the mock is entitled to omit what nothing here
     * uses.
     */
    const shell = (await import("@nextlyhq/builder/shell")) as Record<
      string,
      unknown
    >;
    for (const name of [
      "BuilderShell",
      "Canvas",
      "InspectorPanel",
      "InsertPanel",
      "LayersPanel",
      "TokensPanel",
      "useEditorState",
    ]) {
      expect(shell[name], name).toBeDefined();
    }
  });
});

describe("the shell mock", () => {
  it("carries exports this file never named, so a new one cannot break it here", () => {
    // The property the spread exists for, asserted directly rather than left to
    // be noticed the next time it fails.
    //
    // Named exports are checked rather than a count, because a count agrees with
    // any list of the same size: a spread that dropped `StyleInspectorPanel` and
    // gained something else would match a total and still break the import this
    // is protecting. `StyleInspectorPanel` is named first for being the likeliest
    // next import — it is the surface a per-control provenance badge lives on.
    return import("@nextlyhq/builder/shell").then(shell => {
      for (const name of [
        "StyleInspectorPanel",
        "useShellIsActive",
        "MAX_HISTORY",
        "CANVAS_ROOT_CLASS",
      ]) {
        expect(shell, name).toHaveProperty(name);
      }
    });
  });

  it("still overrides the surfaces it records, so the spread did not undo them", () => {
    // The other half, and the reason a spread cannot simply be trusted: it
    // brings the REAL components with it, and an override that stopped winning
    // would leave these tests rendering the live inspector while every
    // assertion above went on reading a `seen` nothing writes to any more.
    openEditor();

    expect(seen.inspector).toBeDefined();
    expect(seen.canvas).toBeDefined();
  });
});

describe("what the breakpoint manager is told", () => {
  it("is NOT ready while the stored style is still arriving", () => {
    /*
     * The same gate the canvas and the cascade are held behind, and the one
     * whose failure is a write rather than a wrong pixel. Until the read
     * answers, the value handed to the manager is the host's CONFIG DEFAULTS —
     * so an author who opened the dialog then would edit a set the site never
     * chose, and saving it would overwrite the site's real breakpoints with
     * defaults they never saw.
     */
    siteStyleRead = { data: undefined, isPending: true, error: null };

    openEditor();

    expect(seen.breakpoints).toBeDefined();
    expect(seen.breakpoints?.status).toBe("loading");
  });

  it("is NOT ready after a FAILED read, which is not a passing state", () => {
    /*
     * The half a `pending` check alone gets wrong: on failure `pending` goes
     * false while the value falls back to defaults, so gating on pending alone
     * would arm the manager over a tier nobody has read.
     */
    siteStyleRead = {
      data: undefined,
      isPending: false,
      error: new Error("nope"),
    };

    openEditor();

    // Named as the FAILURE it is, not as loading: told "still loading" after a
    // permission denial, an author waits for a request that already finished.
    expect(seen.breakpoints?.status).toBe("unavailable");
  });

  it("IS ready once the read has answered, which is the control", () => {
    /*
     * Without this, a manager that was never ready would satisfy both cases
     * above and the feature would be permanently unreachable rather than
     * gated — which is exactly what shipped once before on this surface, when
     * an `!== undefined` test against an `Error | null` was true on success too.
     */
    openEditor();

    expect(seen.breakpoints?.status).toBe("ready");
  });

  it("refuses an empty set while the host config states breakpoints", async () => {
    /*
     * `resolveSiteStyle` decides "was anything stored" with `hasBreakpoints`,
     * which is `viewport.length > 0 || container.length > 0`. So writing an
     * empty set succeeds, reads back as NOTHING STORED, and the config defaults
     * return — the author removes every row, is told it saved, and watches them
     * reappear.
     *
     * Refused with a reason rather than reported as saved. Representing
     * "explicitly none" would take a stored-format change, which is not a
     * decision this callback makes silently.
     */
    clientConfig = {
      siteStyle: {
        breakpoints: {
          viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
          container: [],
        },
      },
    };

    openEditor();

    const onSave = seen.breakpoints?.onSave as (
      next: unknown
    ) => Promise<string | undefined>;
    expect(onSave).toBeDefined();

    const refusal = await onSave({ viewport: [], container: [] });

    expect(refusal).toBeDefined();
    expect(refusal).toContain("configuration");
  });

  it("does not count a config base row as a configured breakpoint", async () => {
    /*
     * A config carrying only the built-in `{ id: "base" }` row states no
     * authored breakpoint. Counted, it refuses the one save that returns such a
     * site to its base-only state — and tells the author to remove a config row
     * the manager deliberately hides as built in, so the instruction cannot be
     * followed from any screen they can reach.
     */
    clientConfig = {
      siteStyle: {
        breakpoints: {
          viewport: [{ id: "base", label: "Base" }],
          container: [],
        },
      },
    };

    openEditor();

    const onSave = seen.breakpoints?.onSave as (
      next: unknown
    ) => Promise<string | undefined>;
    expect(onSave).toBeDefined();

    await expect(
      onSave({ viewport: [], container: [] })
    ).resolves.toBeUndefined();
  });

  it("saves a NON-empty set, which is the control", async () => {
    // Without this, a callback that refused everything would satisfy the case
    // above and no breakpoint could ever be written.
    clientConfig = {
      siteStyle: {
        breakpoints: {
          viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
          container: [],
        },
      },
    };

    openEditor();

    const onSave = seen.breakpoints?.onSave as (
      next: unknown
    ) => Promise<string | undefined>;

    await expect(
      onSave({
        viewport: [{ id: "mobile", label: "Mobile", maxWidth: 575 }],
        container: [],
      })
    ).resolves.toBeUndefined();
  });

  it("is given the SAME breakpoints the canvas renders against", () => {
    /*
     * One derivation, not two. The manager edits the set the cascade was
     * compiled with, so a second call to `siteBreakpoints` beside the canvas's
     * would let the dialog show and save a set the page was never drawn with.
     */
    openEditor();

    expect(seen.breakpoints?.value).toBe(
      (seen.canvas?.render as { styleContext?: { breakpoints?: unknown } })
        ?.styleContext?.breakpoints
    );
  });
});

describe("what the inspector is told about provenance", () => {
  it("withholds the trace while the stored style is still arriving", () => {
    /*
     * The same reason the canvas is held back, one surface over. While the read
     * is pending `useSiteStyle` answers with the host's config defaults, so a
     * cascade compiled from it is not the page's: a class the site adds is
     * missing and one it overrides is wrong. The dots would say where a value
     * came from, confidently and incorrectly, and then change under the author.
     */
    siteStyleRead = { data: undefined, isPending: true, error: null };

    openEditor();

    expect(seen.inspector).toBeDefined();
    expect(seen.inspector?.cascade).toBeUndefined();
  });

  it("withholds it after a FAILED read, which is not a passing state", () => {
    /*
     * The half that a `pending` check alone gets wrong. On failure `pending`
     * goes false while the value falls back to the defaults, so the inspector
     * would become permanently certain about a tier nobody has read.
     */
    siteStyleRead = {
      data: undefined,
      isPending: false,
      error: new Error("nope"),
    };

    openEditor();

    expect(seen.inspector).toBeDefined();
    expect(seen.inspector?.cascade).toBeUndefined();
  });

  it("passes a trace once the read has ANSWERED", () => {
    /*
     * The control, and it is the most load-bearing assertion in this file.
     *
     * Without it the two withholding tests above are satisfied by a gate that
     * withholds ALWAYS — which is exactly what shipped: `useSiteStyle` types
     * `error` as `Error | null` and normalises success to `null`, so a
     * `!== undefined` test was true on every render and no provenance dot ever
     * appeared anywhere.
     *
     * I wrote this control, watched it fail, and removed it on the reasoning
     * that the harness could not produce a trace — the registry is real and
     * empty, so nothing compiles. That reasoning was available, plausible, and
     * not the cause. A red test explained away is the same error as a green one
     * taken at face value, and this is the shape it takes.
     */
    openEditor();

    expect(seen.inspector).toBeDefined();
    expect(seen.inspector?.cascade).toBeDefined();
  });
});
