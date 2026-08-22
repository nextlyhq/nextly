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

vi.mock("@nextlyhq/builder/shell", () => {
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
