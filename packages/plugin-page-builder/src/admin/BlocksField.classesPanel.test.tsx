// @vitest-environment jsdom

/**
 * The classes manager reaching an author, which is a different claim from the
 * panel working.
 *
 * `class-manager-panel.test.tsx` in the builder asserts the surface and
 * `class-library.test.ts` asserts the rules. Both passed for weeks while the
 * panel was exported, styled, covered — and rendered by nothing, so no author
 * could open it. That is the failure this file exists to catch, and it has
 * already happened once on this chain for the fonts panel.
 *
 * The builder shell is replaced with recorders rather than rendered, as the
 * sibling files do: what is under test is which props this component passes,
 * and that `renderPanel` answers for this key at all.
 *
 * @module admin/BlocksField.classesPanel.test
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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
    /*
      The shell here CALLS `renderPanel`, which the sibling tests' shell does
      not. What is under test is the branch itself: a panel exported, styled and
      covered by its own tests is still invisible to every author while nothing
      renders it, and that is the failure this file exists to catch rather than
      anything about how the panel behaves.
    */
    BuilderShell: ({
      renderPanel,
      availablePanels,
    }: {
      renderPanel?: (panel: string) => React.ReactNode;
      availablePanels?: readonly string[];
    }): React.JSX.Element => (
      <div>
        <div data-testid="rail">{(availablePanels ?? []).join(",")}</div>
        <div data-testid="panel">{renderPanel?.("classes")}</div>
      </div>
    ),
    BlockKeyboardActions: passthrough,
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
  classLibraryAbsence?: "pending" | "failed";
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

describe("the classes manager reaching an author", () => {
  it("offers the classes rail slot at all", () => {
    // The slot was reserved and dark: `LEFT_PANELS` named it and nothing
    // rendered into it, so the shell drew it disabled as "coming soon".
    storedRead = { data: { classes: [] }, isPending: false, error: null };
    openEditor();
    expect(screen.getByTestId("rail").textContent).toContain("classes");
  });

  it("renders the manager into that slot rather than nothing", () => {
    storedRead = {
      data: {
        classes: [{ id: "id-card", slug: "card", orderIndex: 0, styles: {} }],
      },
      isPending: false,
      error: null,
    };
    openEditor();
    const panel = screen.getByTestId("panel");
    expect(panel.textContent).toContain("Classes");
    // The site's OWN class reached it. An empty panel would satisfy the
    // heading assertion alone, which is the shape this file exists to refuse.
    expect(panel.textContent).toContain("card");
  });

  it("draws a read still in flight as loading, not as a site with no classes", () => {
    storedRead = { data: undefined, isPending: true, error: null };
    openEditor();
    expect(screen.getByTestId("panel").textContent).toContain(
      "Loading classes"
    );
  });

  it("says usage was not read, rather than reporting an empty index", () => {
    /*
     * The usage index is a collection and this surface has no read for one.
     * Passing an empty map would print "Not in index" against every class,
     * which is a statement about the site made from never having asked — and
     * it is the direction that reads as permission to delete.
     */
    storedRead = {
      data: {
        classes: [{ id: "id-card", slug: "card", orderIndex: 0, styles: {} }],
      },
      isPending: false,
      error: null,
    };
    openEditor();
    const panel = screen.getByTestId("panel");
    expect(panel.textContent).toContain("Usage not read");
    expect(panel.textContent).not.toContain("Not in index");
  });

  it("offers no Delete while nothing can carry out one", () => {
    // Deleting must strip the class from every document holding it, and no
    // such write exists. A control that cannot keep its promise is withheld
    // rather than shown disabled.
    storedRead = {
      data: {
        classes: [{ id: "id-card", slug: "card", orderIndex: 0, styles: {} }],
      },
      isPending: false,
      error: null,
    };
    openEditor();
    /*
     * The control first. An absent button is equally what a panel that never
     * rendered looks like, so without something that must be FOUND this
     * assertion is satisfied by the very defect the file exists to catch —
     * measured: it passed with `renderPanel` answering nothing for this key.
     */
    expect(screen.getByLabelText("Name of card")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete card" })).toBeNull();
  });

  it("writes the classes section when a name is committed", async () => {
    storedRead = {
      data: {
        classes: [{ id: "id-card", slug: "card", orderIndex: 0, styles: {} }],
      },
      isPending: false,
      error: null,
    };
    openEditor();
    const field = screen.getByLabelText("Name of card");
    fireEvent.change(field, { target: { value: "panel" } });
    fireEvent.blur(field);
    await vi.waitFor(() => expect(saved.length).toBeGreaterThan(0));
    expect(JSON.stringify(saved)).toContain("panel");
  });

  it("shows a refused rename rather than clearing as though it landed", async () => {
    // The field clears as soon as the author finishes typing, so a refusal
    // that reported nothing would leave the row reading as renamed until some
    // later read contradicted it.
    storedRead = {
      data: {
        classes: [{ id: "id-card", slug: "card", orderIndex: 0, styles: {} }],
      },
      isPending: false,
      error: null,
    };
    saveResult = new Error("The site style is locked.");
    openEditor();
    const field = screen.getByLabelText("Name of card");
    await act(async () => {
      fireEvent.change(field, { target: { value: "panel" } });
      fireEvent.blur(field);
    });
    // The write WAS attempted — otherwise a refusal never shown and a refusal
    // never requested look identical, and the assertion below would pass on a
    // panel that simply does not rename.
    expect(saved.length).toBeGreaterThan(0);
    // The HOST's own reason, carried through verbatim rather than replaced by
    // a generic one. A surface that substitutes its own wording tells the
    // author less than the server already said.
    expect(await screen.findByText("The site style is locked.")).toBeTruthy();
  });
});
