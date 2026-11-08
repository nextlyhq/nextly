// @vitest-environment jsdom

/**
 * A bound image in the inspector, drawn over a document the edits really
 * change: the chip on the Source row with an address Fallback, and an unbind
 * from an image address, which lands the address in the block's address
 * prop, leaves the image empty and says so under the Source row.
 */
import {
  applyOp,
  clearBlocks,
  findNode,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type BuilderOp,
} from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { BindingFieldSource, UnbindPlanAnswer } from "./binding-services";
import type { ContentServices } from "./content-controls";
import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

beforeAll(() => {
  // What Radix's menus ask of an element, which jsdom does not draw.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

const ADDRESS = "https://cdn.example.test/spring-banner.jpg";

const SOURCES: readonly BindingFieldSource[] = [
  {
    binding: { source: "entry" },
    label: "Post",
    fields: [
      { name: "cover", type: "upload", relationTo: "media", public: true },
    ],
  },
];

/** A block declaring an image as `core/image` does, its address paired. */
function register(): void {
  registerBlocks(
    [
      {
        name: "acme/picture",
        version: 1,
        description: "A picture.",
        example: { props: {} },
        editor: { label: "Picture" },
        props: {
          mediaId: {
            label: "Image",
            role: "content",
            type: "media",
            accept: "image/*",
            addressProp: "src",
          },
          src: { label: "Image address", role: "content", type: "url" },
          alt: { label: "Alt text", role: "content", type: "text" },
          decorative: { label: "Decorative (no alt text)", type: "checkbox" },
        },
        render: () => null,
      },
    ] as never,
    { source: "binding-controls-image-test" }
  );
}

/** The document as the last edit left it. */
let latest: BlockDocument | undefined;

/** Every op applied, in order, so a test can say what one edit wrote. */
let applied: BuilderOp[] = [];

/** The panel over a document each applied op changes, as the editor's does. */
function Live({
  initial,
  services,
}: {
  initial: BlockDocument;
  services: ContentServices;
}): React.JSX.Element {
  const [document, setDocument] = React.useState(initial);
  latest = document;
  const apply = (op: BuilderOp): BlockDocument => {
    applied.push(op);
    const next = applyOp(document, op).document;
    setDocument(next);
    return next;
  };
  const editor = {
    document,
    selectedId: "a",
    selection: { ids: ["a"], primary: "a" },
    applyAll: () => document,
    select: () => undefined,
    apply,
    undo: () => undefined,
    redo: () => undefined,
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    composed: () => undefined,
  } as unknown as EditorState;
  return <InspectorPanel editor={editor} contentServices={services} />;
}

function mount(
  bindings: BlockNode["bindings"],
  planUnbind?: ContentServices["planUnbind"],
  sources: readonly BindingFieldSource[] = SOURCES,
  props: Record<string, unknown> = {}
): void {
  register();
  applied = [];
  render(
    <Live
      initial={
        {
          formatVersion: 1,
          kind: "page",
          nodes: [
            {
              id: "a",
              type: "acme/picture",
              version: 1,
              props,
              bindings,
            } as BlockNode,
          ],
        } as BlockDocument
      }
      services={{
        listBindingFields: async () => sources,
        ...(planUnbind === undefined ? {} : { planUnbind }),
      }}
    />
  );
}

/** The image block's props, as the last edit stored them. */
function storedProps(): Record<string, unknown> | undefined {
  const node = latest === undefined ? undefined : findNode(latest.nodes, "a");
  return node?.props as Record<string, unknown> | undefined;
}

/** Unbind the image from its chip's menu, as the author does. */
async function unbindImage(): Promise<void> {
  const chip = await screen.findByRole("button", {
    name: "Image: bound to Cover of this post",
  });
  fireEvent.keyDown(chip, { key: "Enter" });
  const unbind = await screen.findByRole("menuitem", {
    name: "Unbind, keep the image",
  });
  fireEvent.pointerUp(unbind, { pointerType: "mouse", button: 0 });
}

/** The image's source group, where an unbind's note is said. */
async function sourceGroup(): Promise<HTMLElement> {
  return waitFor(() => {
    const found = document.querySelector('[data-image-group="source"]');
    if (!(found instanceof HTMLElement)) throw new Error("no source group");
    return found;
  });
}

describe("a bound image", () => {
  it("names a Single's field with the Single, by the host's label where it lists one", async () => {
    const LOGO = {
      $bind: "logo",
      source: "single",
      sourceKey: "related-links",
    } as const;
    // Listed: the host's names for the Single and its field.
    mount({ mediaId: LOGO }, undefined, [
      ...SOURCES,
      {
        binding: { source: "single", sourceKey: "related-links" },
        label: "Brand links",
        fields: [
          {
            name: "logo",
            label: "Brand logo",
            type: "upload",
            relationTo: "media",
            public: true,
          },
        ],
      },
    ]);
    const listed = await screen.findByRole("button", {
      name: "Image: bound to Brand logo of Brand links",
    });
    expect(listed.textContent).toContain("Brand links");
    cleanup();
    clearBlocks();
    // Not listed (a Single with nothing saved yet): still named, by its key.
    mount({ mediaId: LOGO });
    const unlisted = await screen.findByRole("button", {
      name: "Image: bound to Logo of Related links",
    });
    expect(unlisted.getAttribute("title")).toBe("Logo of Related links");
    expect(unlisted.textContent).toContain("Related links");
  });

  it("stands its chip on the Source row, with an address as its Fallback", async () => {
    mount({ mediaId: { $bind: "cover", fallback: ADDRESS } });
    expect(
      await screen.findByRole("button", {
        name: "Image: bound to Cover of this post",
      })
    ).toBeTruthy();
    // The image's own address field, not the plain one: named in full.
    expect(
      screen.getByRole("textbox", { name: `Fallback: ${ADDRESS}` })
    ).toBeTruthy();
    // A bound image draws what its binding gives: neither side is offered.
    expect(screen.queryByRole("radiogroup", { name: "Source" })).toBeNull();
  });

  it("is unbound from an address into Image address, the image left empty, and says so", async () => {
    const plan: UnbindPlanAnswer = {
      kept: { set: { src: ADDRESS }, empty: ["mediaId"] },
      answer: {
        kept: "visitor",
        value: ADDRESS,
        into: "src",
        reason:
          "Visitors saw an image address, not a library image, so it's kept in the image's address.",
      },
    };
    mount({ mediaId: { $bind: "cover" } }, async () => plan);
    await unbindImage();
    // Said under the Source row, naming where the address went by the
    // block's own label for it.
    const group = await sourceGroup();
    expect((await within(group).findByRole("status")).textContent).toBe(
      "Unbound. Visitors saw an image address, not a library image, so it's kept in Image address."
    );
    // The document: the address kept, the image empty, the binding gone.
    expect(storedProps()).toEqual({ src: ADDRESS });
    expect(findNode(latest?.nodes ?? [], "a")?.bindings).toBeUndefined();
    // And the panel: the URL side, holding the address.
    expect(
      screen.getByRole("radio", { name: "URL" }).getAttribute("aria-checked")
    ).toBe("true");
    expect(
      (
        screen.getByRole("textbox", {
          name: "Image address",
        }) as HTMLInputElement
      ).value
    ).toBe(ADDRESS);
  });

  it("says it was the fallback's address where visitors saw the fallback", async () => {
    // The same unbind, where the address kept was the binding's fallback:
    // said so, rather than as an address the field gave.
    const plan: UnbindPlanAnswer = {
      kept: { set: { src: ADDRESS }, empty: ["mediaId"] },
      answer: {
        kept: "fallback",
        value: ADDRESS,
        into: "src",
        reason:
          "The bound image can't be found, so visitors see the fallback; it's kept in the image's address.",
      },
    };
    mount({ mediaId: { $bind: "cover", fallback: ADDRESS } }, async () => plan);
    await unbindImage();
    expect(
      (await within(await sourceGroup()).findByRole("status")).textContent
    ).toBe(
      "Unbound. Visitors saw the fallback's image address, so it's kept in Image address."
    );
    expect(storedProps()).toEqual({ src: ADDRESS });
  });

  it("says nothing of an address for an unbind that kept a library image", async () => {
    // The control for the test above: the same unbind, answered without
    // `into`, keeps the media id in the image and draws no address note.
    const plan: UnbindPlanAnswer = {
      kept: { set: { mediaId: "m-7" }, empty: ["src"] },
      answer: {
        kept: "visitor",
        value: "m-7",
        reason: "The image keeps what visitors saw.",
      },
    };
    mount({ mediaId: { $bind: "cover" } }, async () => plan);
    await unbindImage();
    const status = await within(await sourceGroup()).findByRole("status");
    expect(status.textContent).toBe(
      "Unbound. The picture keeps what visitors saw: “m-7”."
    );
    expect(status.textContent).not.toMatch(/image address/);
    expect(storedProps()).toEqual({ mediaId: "m-7" });
    expect(
      screen
        .getByRole("radio", { name: "Library" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });

  it("does not say no file is chosen while the picture is bound", async () => {
    // The page reads the bound field's file, and its library alt text with
    // it: "no library file" would tell the author screen readers get none.
    mount({ mediaId: { $bind: "cover" } });
    const note = await screen.findByText(/comes from a bound field/);
    expect(screen.queryByText(/No library file is chosen/)).toBeNull();
    // The field may hold an image address, which has no library alt text:
    // the note says so rather than promising a description.
    expect(note.textContent).toMatch(/an image address has none/);
  });

  it("says no file is chosen where the picture is neither bound nor picked", () => {
    // The control: the same alt row, nothing behind the picture.
    mount(undefined);
    expect(screen.getByText(/No library file is chosen/)).toBeTruthy();
    expect(screen.queryByText(/comes from a bound field/)).toBeNull();
  });
});

describe("an image's address bound on the URL side", () => {
  const WITH_URL: readonly BindingFieldSource[] = [
    {
      binding: { source: "entry" },
      label: "Post",
      fields: [{ name: "bannerUrl", type: "url", public: true }],
    },
  ];

  /** Show the URL side and bind the address to the post's banner URL. */
  async function bindAddress(): Promise<void> {
    fireEvent.click(screen.getByRole("radio", { name: "URL" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Bind Image address to a field" })
    );
    fireEvent.click(await screen.findByRole("option", { name: /^Banner url/ }));
  }

  it("empties a stored library file in the same edit", async () => {
    // The block draws a library file before an address: left, the old file
    // would stay published under a bound address.
    mount(undefined, undefined, WITH_URL, { mediaId: "m-1" });
    await bindAddress();
    expect(applied).toEqual([
      {
        kind: "update",
        id: "a",
        patch: { bindings: { src: { $bind: "bannerUrl" } }, props: {} },
      },
    ]);
    expect(storedProps()).toEqual({});
  });

  it("writes the binding alone where no library file is stored", async () => {
    // The control: nothing to empty, so the props stay out of the edit.
    mount(undefined, undefined, WITH_URL);
    await bindAddress();
    expect(applied).toEqual([
      {
        kind: "update",
        id: "a",
        patch: { bindings: { src: { $bind: "bannerUrl" } } },
      },
    ]);
  });
});
