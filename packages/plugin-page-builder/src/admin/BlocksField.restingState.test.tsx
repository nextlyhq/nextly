// @vitest-environment jsdom

/**
 * What the entry form draws BEFORE the editor is opened.
 *
 * The state a page's edit screen spends nearly all of its time in, and the one
 * nothing asserted: on the shipped `pages` collection the blocks field IS the
 * editable body — `title` and `slug` are system fields the header draws — so
 * this is what an author sees when they open a page.
 *
 * Two of the cases below cover failures that pass a careless test.
 *
 * The COLD REGISTRY. `ensureCoreBlocksRegistered()` runs inside `BlocksEditor`
 * and nowhere else, deliberately, so nothing is registered while the form is at
 * rest. Registration is global module state that is never torn down, so a test
 * that opened the editor first would leave every later render able to resolve
 * blocks — and the page would draw here for a reason a real cold page load does
 * not have. The case below therefore observes the empty registry in the
 * assertion rather than trusting the file's ordering.
 *
 * The PENDING SHEET. Omitting `siteStyles` does not draw nothing; the renderer
 * still emits its default tokens, so a page rendered before the site's own
 * sheet arrives looks entirely plausible while missing that site's named
 * classes and block-type defaults. A test asserting only "something rendered"
 * passes on exactly that wrong picture.
 *
 * @module admin/BlocksField.restingState.test
 */
import {
  DOCUMENT_FORMAT_VERSION,
  getBlock,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the stored-style read answers with for the test in hand. */
let siteStyleRead: { data: unknown; isPending: boolean; error: Error | null } =
  { data: undefined, isPending: false, error: null };

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  // Present because the mock REPLACES the module wholesale: an export the
  // subject imports and this omits is a missing-export error rather than an
  // unused stub.
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  usePluginClientConfig: () => undefined,
  useDocumentCheckpoint: () => ({ record: () => {}, clear: () => {} }),
  useEntryFieldsPanel: () => null,
  useReportUnsavedWork: () => {},
  useSuppressAdminChrome: () => {},
  useDocumentStatus: () => null,
  useSingleDocument: () => siteStyleRead,
  useUpdateSingleDocument: () => ({
    mutateAsync: async () => ({ success: true }),
    isPending: false,
  }),
}));

// Imported after the mock, which is what makes it take effect.
const { BlocksField } = await import("./BlocksField");

/*
 * The block's OWN version rather than a literal: the renderer drops a node
 * whose version it cannot reconcile, and it drops it SILENTLY — so a pinned
 * number becomes an empty page the day the block is revised, with this fixture
 * still reading as correct.
 */
const TEXT = coreBlocks.find(block => block.name === "core/text");
if (!TEXT) throw new Error("core/text is missing from coreBlocks");

const PAGE_TEXT = "The words on this page";

const DOCUMENT = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "a",
      type: TEXT.name,
      version: TEXT.version,
      props: { text: PAGE_TEXT },
    },
  ],
} as unknown as BlockDocument;

const MINIATURE = '[data-slot="page-miniature-surface"]';

/** A form around the field, since it reads its value through a form control. */
function Host({ readOnly = false }: { readOnly?: boolean }): React.JSX.Element {
  const { control } = useForm({ defaultValues: { body: DOCUMENT } });
  return <BlocksField name="body" control={control} readOnly={readOnly} />;
}

beforeEach(() => {
  siteStyleRead = { data: undefined, isPending: false, error: null };
});

afterEach(() => {
  cleanup();
});

describe("the entry form at rest", () => {
  it("draws the page itself, with nothing registered", () => {
    // The precondition, OBSERVED rather than assumed. This is the state a cold
    // page load renders in, and the one a test that opened the editor first
    // would silently stop testing.
    expect(getBlock(TEXT.name)).toBeUndefined();

    const { container } = render(<Host />);

    expect(container.querySelector(MINIATURE)).not.toBeNull();
    expect(container.textContent).toContain(PAGE_TEXT);
  });

  it("does not put the block's type name on the screen", () => {
    const { container } = render(<Host />);

    // What stood here before was `core/text` in a mono chip — machinery, where
    // the author needed the page.
    expect(container.textContent).not.toContain(TEXT.name);
  });

  it("draws no page while the site's own style is still arriving", () => {
    siteStyleRead = { data: undefined, isPending: true, error: null };

    const { container } = render(<Host />);

    expect(container.querySelector(MINIATURE)).toBeNull();
    expect(container.textContent).not.toContain(PAGE_TEXT);
  });

  it("still says what the page holds while the style is arriving", () => {
    siteStyleRead = { data: undefined, isPending: true, error: null };

    const { container } = render(<Host />);

    expect(container.textContent).toContain("1 block");
  });

  /*
   * The failed read, end to end.
   *
   * `useSiteStyle` reports the failure and ALSO resolves a style — the config
   * defaults — with `pending` false. So the field must read the error, or it
   * draws a page missing this site's stored classes, tokens and block defaults
   * and looks entirely correct doing it.
   */
  it("draws no page when the site-style read failed", () => {
    siteStyleRead = {
      data: undefined,
      isPending: false,
      error: new Error("site style unavailable"),
    };

    const { container } = render(<Host />);

    expect(container.querySelector(MINIATURE)).toBeNull();
    expect(container.textContent).not.toContain(PAGE_TEXT);
  });

  it("still offers the way into the builder when that read failed", () => {
    siteStyleRead = {
      data: undefined,
      isPending: false,
      error: new Error("site style unavailable"),
    };

    const { container } = render(<Host />);

    expect(container.querySelector("button")).not.toBeNull();
  });

  it("offers no way in when the field cannot be edited", () => {
    const { container } = render(<Host readOnly />);

    expect(container.querySelector("button")).toBeNull();
  });

  it("still draws the page when the field cannot be edited", () => {
    const { container } = render(<Host readOnly />);

    expect(container.querySelector(MINIATURE)).not.toBeNull();
  });
});
