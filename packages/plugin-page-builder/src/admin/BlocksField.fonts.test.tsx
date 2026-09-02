// @vitest-environment jsdom

/**
 * The fonts panel reaching an author, which is a different claim from the panel
 * working.
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
import { OPEN_BUILDER_ACTION } from "./PageBuilderCard";

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
        <div data-testid="panel">{renderPanel?.("fonts")}</div>
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
  fireEvent.click(screen.getByRole("button", { name: OPEN_BUILDER_ACTION }));
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

describe("the fonts panel reaching an author", () => {
  it("offers the fonts rail slot at all", () => {
    // The slot was reserved and dark for the whole of Phase 4: `PANEL_CHROME`
    // named it, `LEFT_PANELS` listed it, and nothing rendered into it, so the
    // shell drew it disabled as "coming soon".
    storedRead = {
      data: { fonts: [], tokens: { tokens: [] } },
      isPending: false,
      error: null,
    };
    openEditor();
    expect(screen.getByTestId("rail").textContent).toContain("fonts");
  });

  it("hands it the site's faces and tokens, not an empty list", () => {
    storedRead = {
      data: {
        fonts: [
          { family: "Brand", src: [{ url: "/f.woff2", format: "woff2" }] },
        ],
        tokens: {
          tokens: [
            {
              name: "brand.body",
              kind: "fontFamily",
              values: { light: "Ghost, serif" },
            },
          ],
        },
      },
      isPending: false,
      error: null,
    };
    openEditor();
    const panel = screen.getByTestId("panel");
    // The face reached it...
    expect(panel.textContent).toContain("Brand");
    // ...and so did the token, which is the half that needs BOTH props: the
    // report is a join, so passing faces alone would draw a silent all-clear.
    expect(panel.textContent).toContain("Ghost");
  });

  it("draws a read still in flight as loading rather than as a site with no fonts", () => {
    // The third state, asserted at the WIRING rather than only in the panel:
    // the panel cannot tell pending from empty unless this file passes
    // `undefined`, and passing `[]` while pending is the plausible bug.
    storedRead = { data: undefined, isPending: true, error: null };
    openEditor();
    expect(screen.getByTestId("panel").textContent).toContain("Loading fonts");
  });

  it("says a failed read failed", () => {
    storedRead = {
      data: undefined,
      isPending: false,
      error: new Error("nope"),
    };
    openEditor();
    expect(screen.getByTestId("panel").textContent).toContain(
      "could not be read"
    );
  });
});
