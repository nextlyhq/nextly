// @vitest-environment jsdom

/**
 * Whether the save-as-pattern verb actually reaches the form.
 *
 * `SavePatternDialog.test` exercises the form and `save-pattern-client.test`
 * the write, and every one of their assertions passes with the two never
 * connected — a verb wired to nothing, or a dialog nothing mounts. An author
 * would press Save as pattern and see the editor do nothing at all.
 *
 * This is the assertion that fails when either half is missing: the verb is
 * supplied to the chain that publishes it, and running it puts the form on
 * screen.
 *
 * The builder shell is replaced with recorders rather than rendered, as the
 * sibling files do and for their reason: what is under test is which props this
 * component passes, and the real shell needs a canvas, a registry and a
 * measured DOM to draw one button.
 *
 * @module admin/BlocksField.savePattern.test
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OPEN_BUILDER_ACTION } from "./PageBuilderCard";

/** The verb the editor published, as the chain was handed it. */
let offeredVerb: (() => void) | undefined;

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
      Stands in for the shell, but keeps the ONE thing below it depends on: the
      real shell provides the shortcut context, and the verbs provider reads it.
      A plain div here fails with "useShortcuts must be called inside a
      ShortcutProvider" — a failure about the harness rather than the subject.
    */
    BuilderShell: ({
      children,
    }: {
      children?: React.ReactNode;
    }): React.JSX.Element => (
      <ShortcutProvider>
        <div>{children}</div>
      </ShortcutProvider>
    ),
    /*
      The REAL provider, wrapped to record what it was handed. Replacing it
      outright would remove the context the palette and the context menu read,
      so the case would fail for a reason that is not the verb — and, worse, a
      recorder that never published the verb could not tell a verb that reaches
      the chain from one that merely reaches this mock.
    */
    BlockKeyboardActions: (props: {
      children?: React.ReactNode;
      onSaveAsPattern?: () => void;
    }): React.JSX.Element => {
      offeredVerb = props.onSaveAsPattern;
      const Real = real.BlockKeyboardActions as React.ComponentType<
        typeof props
      >;
      return <Real {...props} />;
    },
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

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  usePluginClientConfig: () => ({}),
  usePluginRoute: () => ({
    data: undefined,
    pending: false,
    error: null,
    refetch: () => {},
  }),
  // The write the form makes. Never called by these cases — they stop at the
  // form appearing — but the module the form imports resolves it at load, so a
  // mock that omitted it would fail the import rather than the assertion.
  usePluginRouteMutation: () => ({
    write: async () => ({ message: "Pattern created.", item: { id: "p1" } }),
    pending: false,
    error: null,
  }),
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
  useDocumentCheckpoint: () => ({ schedule: () => {} }),
  useEntryFieldsPanel: () => null,
  useReportUnsavedWork: () => {},
  useSuppressAdminChrome: () => {},
  useDocumentStatus: () => null,
  validationIssues: () => [],
  useSingleDocument: () => ({ data: undefined, isPending: false, error: null }),
  useUpdateSingleDocument: () => ({
    mutateAsync: async () => ({ success: true }),
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
  fireEvent.click(screen.getByRole("button", { name: OPEN_BUILDER_ACTION }));
}

beforeEach(() => {
  offeredVerb = undefined;
});

afterEach(cleanup);

describe("reaching the save-as-pattern form", () => {
  it("publishes the verb to the chain every surface reads", () => {
    // Supplied rather than omitted. The chain requires it, so an editor that
    // passed nothing would not compile — but one that passed a function doing
    // nothing would, and that is what this separates.
    openEditor();

    expect(typeof offeredVerb).toBe("function");
  });

  it("shows no form until the verb is run", () => {
    // The control. Without it, a dialog rendered unconditionally would satisfy
    // the case below while putting a modal in front of every author who opened
    // the editor.
    openEditor();

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("puts the form on screen when the verb runs", () => {
    openEditor();

    React.act(() => {
      offeredVerb?.();
    });

    expect(
      screen.getByRole("heading", { name: /save as pattern/i })
    ).toBeTruthy();
  });

  it("takes the form away again when it is dismissed", () => {
    // The form is mounted only while it is up, which is what keeps the library
    // read — the one that supplies its category suggestions — from running on
    // every editor mount.
    openEditor();
    React.act(() => {
      offeredVerb?.();
    });

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(
      screen.queryByRole("heading", { name: /save as pattern/i })
    ).toBeNull();
  });
});
