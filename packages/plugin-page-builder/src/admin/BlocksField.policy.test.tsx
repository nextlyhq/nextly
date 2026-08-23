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

/** Props the recorders captured on the most recent render. */
const seen: {
  inspector: Record<string, unknown> | undefined;
  canvas: Record<string, unknown> | undefined;
} = { inspector: undefined, canvas: undefined };

/** What `usePluginClientConfig` answers with for the test in hand. */
let clientConfig: Record<string, unknown> | undefined;

/** What the stored-style read answers with for the test in hand. */
let siteStyleRead: { data: unknown; isPending: boolean; error: Error | null } =
  {
    data: undefined,
    isPending: false,
    error: null,
  };

// Spread the REAL module, then override. The list below is what this file needs
// to control; everything else the shell exports arrives on its own.
//
// Enumerating instead made the mock a hand-kept mirror of one import statement:
// it declared exactly the sixteen names `BlocksField` imports, so the moment
// that file imports a seventeenth the mock answers `undefined` for it and the
// render fails HERE — in a package whose diff is empty — while `builder`'s own
// suite stays green, because nothing there is mocked.
//
// Spreading is safe for this specifier and was measured rather than assumed:
// importing it opens no EventSource and needs no global the environment lacks.
// It is NOT safe for every mock in this file — the `plugin-sdk/admin` one below
// stays enumerated for that reason.
vi.mock("@nextlyhq/builder/shell", async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
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
    ...actual,
    // Renders the inspector slot and its CHILDREN, because the canvas is a
    // child of the shell rather than one of its slots — a stub dropping them
    // would leave the canvas unrendered and its assertion passing on absence.
    BuilderShell: ({
      inspector,
      children,
    }: {
      inspector: React.ReactNode;
      children?: React.ReactNode;
    }): React.JSX.Element => (
      <div>
        {inspector}
        {children}
      </div>
    ),
    InspectorPanel: record("inspector"),
    Canvas: record("canvas"),
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
  usePluginClientConfig: () => clientConfig,
  useDocumentCheckpoint: () => ({ record: () => {}, clear: () => {} }),
  useEntryFieldsPanel: () => null,
  useReportUnsavedWork: () => {},
  useSuppressAdminChrome: () => {},
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
  fireEvent.click(screen.getByRole("button", { name: "Edit blocks" }));
}

beforeEach(() => {
  seen.inspector = undefined;
  seen.canvas = undefined;
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
