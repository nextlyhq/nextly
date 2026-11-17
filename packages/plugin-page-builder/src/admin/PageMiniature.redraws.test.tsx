/**
 * @vitest-environment jsdom
 */

/**
 * When the entry page's small preview of the page is drawn again.
 *
 * The preview sits in the entry form beside every other field, so a keystroke
 * in the Title re-renders it. It must draw nothing for that: its page did not
 * change. When the page's content does change it draws once, and keeps what
 * its async blocks (an image, a button) already drew, as the canvas does, so
 * nothing in it blinks out while the new draw settles.
 *
 * The real resting-render hook feeds the real miniature; only the reads the
 * hook makes (the plugin's config, the stored site style, the component
 * library) are stood in for, each answering one steady value, as a settled
 * read does. Every draw of the page through the renderer is counted.
 *
 * @module admin/PageMiniature.redraws.test
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState, type JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const counted = vi.hoisted(() => ({
  draws: 0,
  lateRuns: 0,
  siteStyle: undefined as unknown,
}));

vi.mock("@nextlyhq/blocks-react", async importOriginal => {
  const real = await importOriginal<typeof import("@nextlyhq/blocks-react")>();
  const PageRenderer: typeof real.PageRenderer = props => {
    counted.draws += 1;
    return real.PageRenderer(props);
  };
  return { ...real, PageRenderer };
});

vi.mock("./entry-block-resolver", async () => {
  const { createBlockResolver, defineBlock } = await import(
    "@nextlyhq/blocks-react"
  );
  const { createElement } = await import("react");
  const text = defineBlock<{ text: string }>({
    name: "acme/text",
    version: 1,
    description: "A line of text.",
    example: { props: { text: "" } },
    defaultProps: { text: "" },
    render: ({ className, props }) =>
      createElement("p", { className }, props.text),
  });
  // The shape of an image or a button: drawn after a promise settles.
  const late = defineBlock<Record<string, never>>({
    name: "acme/late",
    version: 1,
    description: "Draws after a promise, as an image does.",
    example: { props: {} },
    defaultProps: {},
    render: async ({ className }) => {
      counted.lateRuns += 1;
      await Promise.resolve();
      return createElement("img", { className, alt: "Logo" });
    },
  });
  const resolver = createBlockResolver([text, late] as never);
  return { entryBlockResolver: () => resolver };
});

const CONFIG = {};
// The admin's media read, which the picture resolves images through: one
// function for every call, as the admin's own hook keeps it.
const READ_MEDIA = async () => null;
vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  usePluginClientConfig: () => CONFIG,
  useMediaResolver: () => READ_MEDIA,
}));

vi.mock("./site-style-client", () => ({
  // A settled read answers the style it holds, the same object each render
  // until the style changes.
  useSiteStyle: () => ({
    siteStyle: counted.siteStyle,
    pending: false,
    error: null,
  }),
}));

const LIBRARY = {
  definitions: new Map(),
  state: "ready",
  retry: () => undefined,
  titleOf: () => undefined,
};
vi.mock("./component-library-client", () => ({
  useComponentLibrary: () => LIBRARY,
}));

import { PageMiniature } from "./PageMiniature";
import { useRestingPageRender } from "./use-resting-page-render";

afterEach(cleanup);
beforeEach(() => {
  counted.draws = 0;
  counted.lateRuns = 0;
  counted.siteStyle = undefined;
});

function pageWith(text: string): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      { id: "logo", type: "acme/late", version: 1, props: {} },
      { id: "line", type: "acme/text", version: 1, props: { text } },
    ],
  } as BlockDocument;
}

/** The entry form, reduced: a Title field beside the blocks field's preview. */
function EntryForm({ document }: { document: BlockDocument }): JSX.Element {
  const [title, setTitle] = useState("");
  const resting = useRestingPageRender("page-builder", document);
  return (
    <>
      <input
        aria-label="Title"
        value={title}
        onChange={event => setTitle(event.target.value)}
      />
      <PageMiniature
        document={document}
        siteStyles={resting.siteStyles}
        render={resting.render}
      />
    </>
  );
}

describe("the entry page's preview of the page", () => {
  it("the counter sees the preview drawn: opening the form draws it", async () => {
    await act(async () => {
      render(<EntryForm document={pageWith("Hello")} />);
    });
    expect(counted.draws).toBeGreaterThan(0);
    expect(
      screen.getByRole("img", { name: "Logo", hidden: true })
    ).toBeTruthy();
  });

  it("draws nothing again while another field of the entry changes", async () => {
    const document = pageWith("Hello");
    await act(async () => {
      render(<EntryForm document={document} />);
    });
    counted.draws = 0;
    const title = screen.getByLabelText("Title");
    for (const value of ["A", "Ab", "Abc"]) {
      fireEvent.change(title, { target: { value } });
    }
    // The control: the field took the keystrokes, so the form re-rendered.
    expect((title as HTMLInputElement).value).toBe("Abc");
    expect(counted.draws).toBe(0);
  });

  it("draws once when the page's content changes, keeping what its async blocks drew", async () => {
    const view = await act(async () =>
      render(<EntryForm document={pageWith("Hello")} />)
    );
    const logo = screen.getByRole("img", { name: "Logo", hidden: true });
    const runs = counted.lateRuns;
    counted.draws = 0;
    await act(async () => {
      view.rerender(<EntryForm document={pageWith("Edited")} />);
    });
    expect(screen.getByText("Edited")).toBeTruthy();
    expect(counted.draws).toBe(1);
    // The logo did not change, so it was neither run again nor drawn afresh.
    expect(screen.getByRole("img", { name: "Logo", hidden: true })).toBe(logo);
    expect(counted.lateRuns).toBe(runs);
  });

  it("draws once when the site's style changes, keeping what its async blocks drew", async () => {
    const document = pageWith("Hello");
    const view = await act(async () =>
      render(<EntryForm document={document} />)
    );
    const logo = screen.getByRole("img", { name: "Logo", hidden: true });
    const runs = counted.lateRuns;
    counted.draws = 0;
    counted.siteStyle = {
      breakpoints: {
        viewport: [{ id: "base", label: "Desktop" }],
        container: [],
      },
    };
    await act(async () => {
      view.rerender(<EntryForm document={document} />);
    });
    expect(counted.draws).toBe(1);
    expect(screen.getByRole("img", { name: "Logo", hidden: true })).toBe(logo);
    expect(counted.lateRuns).toBe(runs);
  });
});
