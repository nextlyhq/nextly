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
  COMPONENT_INSTANCE_TYPE,
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

/**
 * What the component route answers with for the test in hand.
 *
 * `undefined` — a site with no components — is what every case not about
 * instances was written against; the one that is puts a definition here.
 */
let componentAnswer: { items: unknown[]; meta: unknown } | undefined;

/** Every plugin route a render actually asked for, in order. */
const fetched: string[] = [];

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  // Present because the mock REPLACES the module wholesale: an export the
  // subject imports and this omits is a missing-export error rather than an
  // unused stub.
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  usePluginClientConfig: () => undefined,
  // No document around the field: the state every case here was written
  // against, and the one that offers every component.
  useDocumentIdentity: () => null,
  // Nor a language the field could know: the component read asks for the
  // app default.
  useDocumentLocale: () => null,
  /*
   * The plugin's reads. The component route is the one the resting card makes,
   * and it is discriminated by PATH so the answer meant for it cannot reach a
   * read of something else. Everything else answers nothing: `pending: false`
   * says the read ANSWERED with nothing, which is the site with an empty
   * library — the state every one of these cases was written against.
   */
  usePluginRoute: (args: { path: string; enabled?: boolean }) => {
    // Modelled the way TanStack treats a disabled query: nothing is requested,
    // and it stays `pending` because it never ran. A stub that answered anyway
    // could not tell a read that was made from one that was not.
    const enabled = args.enabled !== false;
    if (enabled) fetched.push(args.path);
    return {
      data:
        enabled && args.path === "/library/components"
          ? componentAnswer
          : undefined,
      pending: !enabled,
      error: null,
      refetch: () => {},
    };
  },
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

const DEFINITION_TEXT = "The words inside the component";

/** A page holding ONE instance, and nothing of what the instance draws. */
const PAGE_WITH_INSTANCE = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "i1",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "header" },
    },
  ],
} as unknown as BlockDocument;

/** The definition that instance points at, as the component route answers it. */
const HEADER_DEFINITION = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [
    {
      id: "d1",
      type: TEXT.name,
      version: TEXT.version,
      props: { text: DEFINITION_TEXT },
    },
  ],
};

/** A form around the field, since it reads its value through a form control. */
function Host({
  readOnly = false,
  document = DOCUMENT,
}: {
  readOnly?: boolean;
  document?: BlockDocument;
}): React.JSX.Element {
  const { control } = useForm({ defaultValues: { body: document } });
  return <BlocksField name="body" control={control} readOnly={readOnly} />;
}

beforeEach(() => {
  siteStyleRead = { data: undefined, isPending: false, error: null };
  componentAnswer = undefined;
  fetched.length = 0;
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

  it("draws a placed component from the definition the component route answered", () => {
    // The card draws the page with the SAME renderer the canvas does, and that
    // renderer inlines an instance from a map it is handed — with no map, every
    // instance is the could-not-be-loaded marker. Measured before this read
    // reached the card: a component placed in the editor drew on the canvas
    // and became that marker the moment the author pressed Done.
    componentAnswer = {
      items: [{ id: "header", title: "Header", document: HEADER_DEFINITION }],
      meta: { count: 1, truncated: false },
    };

    const { container } = render(<Host document={PAGE_WITH_INSTANCE} />);

    expect(container.querySelector(MINIATURE)).not.toBeNull();
    expect(container.textContent).toContain(DEFINITION_TEXT);
  });

  it("draws nothing of a component the route did not answer with", () => {
    // The control for the case above: the definition's words reach the card
    // through the read and through nothing else.
    const { container } = render(<Host document={PAGE_WITH_INSTANCE} />);

    expect(container.querySelector(MINIATURE)).not.toBeNull();
    expect(container.textContent).not.toContain(DEFINITION_TEXT);
  });

  it("does not read the component library for a page that places no component", () => {
    /*
     * This surface is EVERY entry form holding a blocks field, and the read is
     * the whole component tier: one listing over every row, a read of its own
     * per row to reach the working draft, bounded at sixteen mebibytes. A page
     * that places no instance resolves nothing against any of it, so the
     * miniature is identical without it.
     *
     * The card must not sit waiting on it either — a read that never runs
     * never stops pending, and a surface keyed on that would wait forever.
     */
    const { container } = render(<Host />);

    expect(fetched).not.toContain("/library/components");
    expect(container.querySelector(MINIATURE)).not.toBeNull();
    expect(container.textContent).toContain(PAGE_TEXT);
  });

  it("reads it for a page that places one", () => {
    // The control: the rule is what the DOCUMENT holds, not a read this
    // surface never makes.
    render(<Host document={PAGE_WITH_INSTANCE} />);

    expect(fetched).toContain("/library/components");
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
