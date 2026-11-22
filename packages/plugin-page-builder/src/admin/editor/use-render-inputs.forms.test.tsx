// @vitest-environment jsdom
/**
 * A picked form drawn on the canvas is drawn again when the author comes
 * back to the editor, wherever it sits in what the canvas draws: on the
 * page, inside a component the page places, or in the header or footer of
 * its Layout. The form may have been published, closed or deleted in its
 * own tab meanwhile, and the renderer keeps a Form's drawn output for as
 * long as the canvas's context is the same object.
 *
 * Asked of the trees the canvas draws, composed from the component
 * definitions the editor read as the author: a placement whose component the
 * author can't read draws nothing, so nothing in it is drawn again.
 *
 * @module admin/editor/use-render-inputs.forms.test
 */
import {
  clearBlocks,
  registerBlocks,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
  type DefinitionsById,
} from "@nextlyhq/blocks-engine";
import { createStandaloneContext } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<object>()),
  // No one signed in yet, so the canvas's bindings read nothing here.
  useCurrentUserId: () => null,
  readPluginRoute: vi.fn(async () => undefined),
  writePluginRoute: vi.fn(async () => undefined),
}));

const { pageRenderInputs } = await import("../page-render-inputs");
const { useBoundCanvasRender } = await import("./use-render-inputs");

/** A Form picking form 7 from the Forms provider. */
function pickedForm(id: string): BlockNode {
  return {
    id,
    type: "core/form",
    version: 2,
    props: { form: { provider: "forms", ref: "7" } },
  };
}

/** A Form editing its own fields, which no provider describes. */
const SIMPLE_FORM: BlockNode = {
  id: "simple",
  type: "core/form",
  version: 2,
  props: {},
};

/** A placement of component `componentId`. */
function placement(id: string, componentId: string): BlockNode {
  return {
    id,
    type: "nextly/component-instance",
    version: 1,
    props: { componentId },
  };
}

function page(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes };
}

function component(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "component", nodes };
}

/** The canvas's render inputs under `definitions`, with a context of its own. */
function canvasRenderWith(definitions: DefinitionsById) {
  return {
    ...pageRenderInputs({ siteStyle: {}, definitions }),
    context: createStandaloneContext({ diagnostics: true }),
  };
}

/** The author coming back to the editor's tab. */
function shownAgain(): void {
  act(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/** The context the canvas draws under, before and after a return. */
async function aroundAReturn(
  drawn: Parameters<typeof useBoundCanvasRender>[1],
  definitions: DefinitionsById
): Promise<{ before: unknown; after: unknown }> {
  const render = canvasRenderWith(definitions);
  const { result } = renderHook(() =>
    useBoundCanvasRender(render, drawn, "en", false)
  );
  const before = result.current.canvasRender.context;
  // Until a return, the canvas draws under the editor's one context.
  expect(before).toBe(render.context);
  shownAgain();
  // The round is a transition: give it the time it takes to commit.
  await waitFor(() => expect(result.current.canvasRender).toBeDefined());
  await act(async () => {});
  return { before, after: result.current.canvasRender.context };
}

beforeEach(() => {
  registerBlocks(coreBlocks as AnyBlockDefinition[]);
});

afterEach(() => {
  clearBlocks();
});

describe("a picked form, when the author comes back to the editor", () => {
  it("is drawn again on the page itself", async () => {
    const { before, after } = await aroundAReturn(
      { document: page([pickedForm("f")]), regions: [] },
      new Map()
    );
    expect(after).not.toBe(before);
  });

  it("is drawn again inside a component the page places", async () => {
    const { before, after } = await aroundAReturn(
      { document: page([placement("p1", "signup")]), regions: [] },
      new Map([["signup", component([pickedForm("inner")])]])
    );
    expect(after).not.toBe(before);
  });

  it("is drawn again in the header of the page's Layout", async () => {
    const { before, after } = await aroundAReturn(
      {
        document: page([SIMPLE_FORM]),
        regions: [
          {
            document: page([placement("h1", "site-header")]),
            definitions: new Map([
              ["site-header", component([pickedForm("in-header")])],
            ]),
          },
        ],
      },
      new Map()
    );
    expect(after).not.toBe(before);
  });

  it("is not drawn again for a component the author can't read, which draws nothing", async () => {
    // The library read as the author answered no definition for it.
    const { before, after } = await aroundAReturn(
      { document: page([placement("p1", "private")]), regions: [] },
      new Map()
    );
    expect(after).toBe(before);
  });

  it("draws nothing again on a page drawing no picked form", async () => {
    const { before, after } = await aroundAReturn(
      { document: page([SIMPLE_FORM]), regions: [] },
      new Map([["signup", component([SIMPLE_FORM])]])
    );
    expect(after).toBe(before);
  });
});
