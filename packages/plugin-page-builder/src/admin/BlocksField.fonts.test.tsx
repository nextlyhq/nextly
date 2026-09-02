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
/*
 * What an upload answers with, and every file that reached it. A double that
 * always succeeded could not show a refused save leaving a stored object, and
 * counting the calls is how a retry that re-uploads the same bytes is seen.
 */
let uploadResult: { id: string; mimeType: string } | Error;
const uploads: File[] = [];
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

/*
 * A closed literal, and deliberately still one. Deriving it from the real
 * module — which is what stops a new import failing here as though the
 * component were broken — cannot be done under jsdom: spreading
 * `plugin-sdk/admin` evaluates the admin module, which reaches `EventSource`
 * at import time and throws inside the hoisted factory. That is recorded
 * separately; until it is closed, a name the component starts importing has to
 * be added here by hand.
 */
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
  /*
   * Named explicitly despite the spread: uploading reaches the network, and a
   * test that renders this panel must not. Answering a refusal rather than a
   * success keeps the double from being MORE capable than the real hook —
   * nothing here exercises a stored file, and a double that pretended to store
   * one would let a broken upload path pass.
   */
  useUploadMedia: () => ({
    mutateAsync: async (input: { file: File }) => {
      uploads.push(input.file);
      if (uploadResult instanceof Error) throw uploadResult;
      return uploadResult;
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
  uploadResult = { id: "m-new", mimeType: "font/woff2" };
  uploads.length = 0;
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

describe("adding a font file through the panel", () => {
  /** Choose a file, as the picker hands one over. */
  async function pickFile(name = "Inter-Regular.woff2"): Promise<void> {
    const input = screen.getByLabelText("Font file") as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [new File([new Uint8Array([0x77])], name, { type: "font/woff2" })],
      configurable: true,
    });
    await act(async () => {
      fireEvent.change(input);
    });
  }

  /** Press Add. Separate from the pick, because a RETRY is a second press on
   *  the same file — the form keeps it on a refusal — and re-picking would
   *  hand over a different `File`, which is a different case entirely. */
  async function submitAdd(): Promise<void> {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add font file/i }));
    });
  }

  async function addFace(name = "Inter-Regular.woff2"): Promise<void> {
    await pickFile(name);
    await submitAdd();
  }

  it("appends to the STORED faces, not the config ones", async () => {
    /*
     * `save` replaces the section outright. Building the new list from the
     * config tier dropped every face already stored — so adding a second face
     * replaced the first — while copying config faces into storage stops them
     * tracking the config they came from.
     */
    clientConfig = {
      siteStyle: {
        fonts: [{ family: "FromConfig", src: [{ url: "/c.woff2" }] }],
      },
    };
    storedRead = {
      data: {
        fonts: [{ family: "AlreadyStored", src: [{ url: "/s.woff2" }] }],
      },
      isPending: false,
      error: null,
    };
    openEditor();
    await addFace();

    const written = saved.at(-1) as { fonts: Array<{ family: string }> };
    expect(written.fonts.map(f => f.family)).toEqual([
      "AlreadyStored",
      "Inter",
    ]);
  });

  it("REFUSES when the document holds a font row this version cannot read", async () => {
    /*
     * The read drops a row it cannot type, which is right for a render and
     * wrong as a base for a write: `save` replaces the section, so appending
     * to the read value saves a list the dropped row is missing from — and the
     * save SUCCEEDS, because what it sends is exactly what the checker
     * approves. The row is deleted and the author is told it worked.
     */
    storedRead = {
      data: {
        fonts: [
          { family: "Readable", src: [{ url: "/s.woff2" }] },
          // No `src` array, so the reader cannot type it and drops it.
          { family: "FromAnOlderShape", source: "/legacy.woff" },
        ],
      },
      isPending: false,
      error: null,
    };
    openEditor();
    await addFace();

    expect(saved).toHaveLength(0);
    // Before the upload, so no bytes are stored that nothing will reference.
    expect(uploads).toHaveLength(0);
    expect(screen.getByRole("alert").textContent).toContain("fonts[1]");
  });

  it("adds normally when every stored row IS readable", async () => {
    /*
     * The control for the case above: a refusal keyed on something other than
     * the drop — the row count, a non-empty section — would also refuse here,
     * and the panel would be unable to add a font to any site that has one.
     */
    storedRead = {
      data: {
        fonts: [{ family: "Readable", src: [{ url: "/s.woff2" }] }],
      },
      isPending: false,
      error: null,
    };
    openEditor();
    await addFace();

    expect(saved).toHaveLength(1);
    expect(uploads).toHaveLength(1);
  });

  it("keeps the first face when a second add arrives before the read catches up", async () => {
    /*
     * The invalidation after a save is started with `void`, so the mutation
     * resolves before the refetch that carries the new face into the read. An
     * author adding a family's regular and then its bold reaches the second
     * add while the read still describes the document as it was — and a base
     * taken from it saves the second face OVER the first.
     *
     * The read is deliberately left unchanged between the two adds, which is
     * exactly the window: what the writer saved must survive in the list it
     * builds next, without the read having reported it.
     */
    storedRead = { data: { fonts: [] }, isPending: false, error: null };
    openEditor();

    await addFace("Inter-Regular.woff2");
    uploadResult = { id: "m-2", mimeType: "font/woff2" };
    await addFace("Inter-Bold.woff2");

    const written = saved.at(-1) as { fonts: Array<{ family: string }> };
    expect(written.fonts).toHaveLength(2);
    expect(written.fonts.map(f => f.family)).toEqual(["Inter", "Inter"]);
  });

  it("takes the format hint from the type validation settled on", async () => {
    /*
     * WOFF rather than WOFF2, because the two are separate rows in the shared
     * table and a hint restated in this module would have to carry both. A
     * browser told the wrong format skips the source without trying it.
     */
    uploadResult = { id: "m-woff", mimeType: "font/woff" };
    storedRead = { data: { fonts: [] }, isPending: false, error: null };
    openEditor();
    await addFace("Inter-Regular.woff");

    const written = saved.at(-1) as {
      fonts: Array<{ src: Array<{ format?: string }> }>;
    };
    expect(written.fonts[0]?.src[0]?.format).toBe("woff");
  });

  it("REFUSES while the stored faces are still loading", async () => {
    /*
     * An append derived from a read that has not arrived writes the new face
     * alone and discards the rest — and reports success. Waiting costs one
     * message; the alternative is silent loss.
     */
    storedRead = { data: undefined, isPending: true, error: null };
    openEditor();

    /*
     * The reachable guarantee: the panel draws its loading state and the form
     * is NOT rendered, so an author cannot start an add against faces that
     * have not arrived. The writer refuses as well, which no test can drive
     * through this UI precisely because of this.
     */
    expect(screen.getByTestId("panel").textContent).toContain("Loading fonts");
    expect(screen.queryByLabelText("Font file")).toBeNull();
    expect(saved).toHaveLength(0);
  });

  it("REFUSES media that is not a font, rather than saving a dead face", async () => {
    /*
     * The picker's `accept` is a hint a caller can bypass, and the media
     * pipeline takes far more than fonts. A PNG saved as a face carries no
     * `format()` — which the validator permits — and the byte route answers
     * 404 for it, so the site would hold a family that never loads.
     */
    uploadResult = { id: "m-png", mimeType: "image/png" };
    storedRead = { data: { fonts: [] }, isPending: false, error: null };
    openEditor();
    await addFace("not-a-font.png");

    expect(saved).toHaveLength(0);
    expect(screen.getByRole("alert").textContent).toContain("woff");
  });

  it("does not upload the same file twice when the save is refused", async () => {
    /*
     * The two writes cannot be one — the bytes need an id before a face can
     * point at one — so a refused save leaves a stored object no face
     * references. Re-uploading on every retry turned a run of refusals into a
     * copy per attempt.
     */
    saveResult = new Error("refused");
    storedRead = { data: { fonts: [] }, isPending: false, error: null };
    openEditor();

    await pickFile();
    await submitAdd();
    await submitAdd();

    expect(uploads).toHaveLength(1);
  });
});
