// @vitest-environment jsdom

/**
 * The data picker while a component is edited on its own: "This component's
 * settings" first, each with its default beside it, then Singles and the
 * site, folded; "Used on N pages" from the count the component's view reads;
 * and a pick binding the block to the setting, as the save then takes it.
 */
import {
  applyOp,
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type BuilderOp,
  type ComponentDocument,
  type ExposedProperty,
} from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { boundField, boundNames } from "./binding-bound-names";
import type { BindingFieldSource } from "./binding-services";
import { settingBoundFrom, settingSource } from "./binding-setting-source";
import type { ComponentFieldsHost } from "../component-fields";
import type { ContentServices } from "../inspector/content/content-controls";
import type { EditorState } from "../editor-state";
import { InspectorPanel } from "../inspector/inspector-panel";

beforeAll(() => {
  // The active option is scrolled into view, which jsdom does not draw.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

/**
 * What the host lists while a component is edited on its own: no entry, as
 * a component has none of its own, so only a Single and the site.
 */
const SOURCES: readonly BindingFieldSource[] = [
  {
    binding: { source: "single", sourceKey: "homepage" },
    label: "Homepage",
    fields: [{ name: "title", type: "text", public: true, preview: "Home" }],
  },
  {
    binding: { source: "site" },
    label: "Site",
    fields: [
      {
        name: "applicationName",
        type: "text",
        public: true,
        preview: "Foursight",
      },
    ],
  },
];

const setting = (
  id: string,
  label: string,
  nodeId: string,
  propPath: string,
  type: ExposedProperty["type"] = "text"
): ExposedProperty => ({ id, label, nodeId, propPath, type });

/** A card: its title and eyebrow are settings; the heading follows none yet. */
const SETTINGS: readonly ExposedProperty[] = [
  setting("card-title", "Card title", "title", "text"),
  setting("eyebrow", "Eyebrow", "eyebrow", "text"),
  setting("picture", "Picture", "pic", "media", "image"),
  setting("shown", "Show the title", "title", "hidden", "visibility"),
];

const block = (id: string, text: string | undefined): BlockNode =>
  ({
    id,
    type: "acme/title",
    version: 1,
    props: text === undefined ? {} : { text },
  }) as BlockNode;

/** The heading's inspector in the card's own view, with what is given. */
function mount({
  bindings,
  pages,
  kind = "component",
}: {
  bindings?: BlockNode["bindings"];
  pages?: ComponentFieldsHost["pages"];
  kind?: "component" | "page";
} = {}): { editor: EditorState } {
  registerBlocks(
    [
      {
        name: "acme/title",
        version: 1,
        description: "A title.",
        example: { props: {} },
        editor: { label: "Heading" },
        props: { text: { label: "Text", role: "content", type: "text" } },
        defaultProps: {},
        render: () => null,
      },
    ] as never,
    { source: "binding-component-settings-test" }
  );
  const heading = {
    ...block("h", "A heading"),
    ...(bindings === undefined ? {} : { bindings }),
  } as BlockNode;
  const nodes = [
    block("title", "Apply now"),
    block("eyebrow", undefined),
    block("pic", undefined),
    heading,
  ];
  const document = (
    kind === "component"
      ? ({
          formatVersion: DOCUMENT_FORMAT_VERSION,
          kind: "component",
          nodes,
          exposed: [...SETTINGS],
        } satisfies ComponentDocument)
      : { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes }
  ) as BlockDocument;
  let current = document;
  const editor = {
    document,
    selectedId: "h",
    selection: { ids: ["h"], primary: "h" },
    applyAll: vi.fn(() => document),
    select: vi.fn(),
    apply: vi.fn((op: BuilderOp) => {
      current = applyOp(current, op).document;
      return current;
    }),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    composed: () => undefined,
  } as unknown as EditorState;
  const contentServices: ContentServices = {
    listBindingFields: async () => SOURCES,
  };
  render(
    <InspectorPanel
      editor={editor}
      contentServices={contentServices}
      {...(pages === undefined ? {} : { componentFields: { pages } })}
    />
  );
  return { editor };
}

async function openPicker(): Promise<HTMLElement> {
  fireEvent.click(
    await screen.findByRole("button", { name: "Bind Text to a field" })
  );
  return screen.findByRole("listbox", { name: "Fields for Text" });
}

function groupNames(list: HTMLElement): (string | null)[] {
  return within(list)
    .getAllByRole("group")
    .map(group => group.getAttribute("aria-label"));
}

function rows(list: HTMLElement, group: string): (string | null)[] {
  return within(within(list).getByRole("group", { name: group }))
    .getAllByRole("option")
    .map(option => option.textContent);
}

describe("the picker in a component's own view", () => {
  it("lists the component's settings first, then Singles and the site folded", async () => {
    mount();
    const list = await openPicker();
    await within(list).findByRole("group", {
      name: "This component's settings",
    });
    expect(groupNames(list)).toEqual([
      "This component's settings",
      "Singles · Site",
    ]);
    expect(rows(list, "Singles · Site")).toEqual(["Homepage", "Site settings"]);
  });

  it("lists the settings a text can follow, each with its default", async () => {
    mount();
    const list = await openPicker();
    await within(list).findByRole("group", {
      name: "This component's settings",
    });
    // The picture is an image and the visibility setting shows or hides,
    // so neither can fill a text; an empty default is said as "(empty)".
    expect(rows(list, "This component's settings")).toEqual([
      "Card titleApply now",
      "Eyebrow(empty)",
    ]);
  });

  it("binds a pick to the setting, by its id", async () => {
    const { editor } = mount();
    const list = await openPicker();
    fireEvent.click(
      await within(list).findByRole("option", { name: /^Card title/ })
    );
    const op = vi.mocked(editor.apply).mock.calls[0]?.[0] as BuilderOp;
    expect(op).toMatchObject({
      kind: "update",
      id: "h",
      patch: {
        bindings: { text: { $bind: "card-title", source: "setting" } },
      },
    });
  });

  it("reaches a setting from the keyboard", async () => {
    const { editor } = mount();
    const list = await openPicker();
    await within(list).findByRole("group", {
      name: "This component's settings",
    });
    fireEvent.keyDown(list, { key: "Home" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    const op = vi.mocked(editor.apply).mock.calls[0]?.[0] as BuilderOp;
    expect(op).toMatchObject({
      patch: { bindings: { text: { $bind: "eyebrow", source: "setting" } } },
    });
  });

  it.each([
    [{ count: 4, complete: true }, "Used on 4 pages."],
    [{ count: 1, complete: true }, "Used on 1 page."],
    [{ count: 4, complete: false }, "Used on at least 4 pages."],
    [{ count: 0, complete: true }, "Not used on any page yet."],
  ])("says how many pages use it: %o", async (pages, said) => {
    mount({ pages });
    const list = await openPicker();
    await within(list).findByRole("group", {
      name: "This component's settings",
    });
    const note = screen.getByText(content => content.startsWith(said));
    expect(note.textContent).toBe(
      `${said} Each page that places it can set its own value.`
    );
  });

  it("says no count while the view has none, only the hint", async () => {
    mount();
    const list = await openPicker();
    await within(list).findByRole("group", {
      name: "This component's settings",
    });
    expect(
      screen.getByText("Each page that places it can set its own value.")
    ).toBeTruthy();
    expect(screen.queryByText(/Used on/)).toBeNull();
  });

  it("says only the hint while the count is not whole and finds none", async () => {
    mount({ pages: { count: 0, complete: false } });
    const list = await openPicker();
    await within(list).findByRole("group", {
      name: "This component's settings",
    });
    expect(
      screen.getByText("Each page that places it can set its own value.")
    ).toBeTruthy();
  });

  it("names a bound setting on the chip, with no Fallback under it", async () => {
    mount({ bindings: { text: { $bind: "card-title", source: "setting" } } });
    await screen.findByRole("button", {
      name: "Text: bound to Card title of this component's settings",
    });
    // The setting's value is what the block shows, its default where a page
    // gives none, so a fallback would never be shown.
    expect(screen.queryByLabelText("Fallback")).toBeNull();
  });

  it("offers a Fallback for a Single's field, as the control", async () => {
    mount({
      bindings: {
        text: { $bind: "title", source: "single", sourceKey: "homepage" },
      },
    });
    await screen.findByRole("button", { name: /^Text: bound to Title/ });
    expect(screen.getByLabelText("Fallback")).toBeTruthy();
  });

  it("marks the setting bound now when the field is changed", async () => {
    mount({ bindings: { text: { $bind: "eyebrow", source: "setting" } } });
    const chip = await screen.findByRole("button", {
      name: /^Text: bound to Eyebrow/,
    });
    fireEvent.keyDown(chip, { key: "Enter" });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Change field…" })
    );
    const list = await screen.findByRole("listbox", {
      name: "Fields for Text",
    });
    await within(list).findByRole("group", {
      name: "This component's settings",
    });
    const marked = list.querySelectorAll("[data-current]");
    expect(marked).toHaveLength(1);
    expect(marked[0]?.textContent).toMatch(/^Eyebrow/);
  });

  it("carries no fallback into a setting when the field is changed", async () => {
    const { editor } = mount({
      bindings: {
        text: {
          $bind: "title",
          source: "single",
          sourceKey: "homepage",
          fallback: "Welcome",
        },
      },
    });
    const chip = await screen.findByRole("button", {
      name: /^Text: bound to Title/,
    });
    fireEvent.keyDown(chip, { key: "Enter" });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Change field…" })
    );
    const list = await screen.findByRole("listbox", {
      name: "Fields for Text",
    });
    fireEvent.click(
      await within(list).findByRole("option", { name: /^Card title/ })
    );
    const op = vi.mocked(editor.apply).mock.calls[0]?.[0] as BuilderOp;
    // Composing drops a setting's binding, so a fallback on it is never read.
    expect(op).toMatchObject({ kind: "update", id: "h" });
    expect(
      (op as Extract<BuilderOp, { kind: "update" }>).patch.bindings
    ).toEqual({ text: { $bind: "card-title", source: "setting" } });
  });

  it("lists no settings group on a page", async () => {
    // The control: the same blocks and settings, in a page.
    mount({ kind: "page" });
    const list = await openPicker();
    await within(list).findByRole("group", { name: "Homepage" });
    expect(groupNames(list)).toEqual(["Homepage", "Site"]);
    expect(screen.queryByText(/places it/)).toBeNull();
  });
});

describe("a bound setting's field, as the chip and the image controls read it", () => {
  const card = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [
      block("title", "Apply now"),
      block("pic", undefined),
      block("h", ""),
    ],
    exposed: [...SETTINGS],
  } as BlockDocument;

  it("keeps an image setting's type, as the picker lists it", () => {
    const binding = { $bind: "picture", source: "setting" } as const;
    const from = settingBoundFrom(binding, card);
    const listed = settingSource(
      card,
      "h",
      {
        name: "media",
        schema: { type: "media", label: "Image", role: "content" },
        value: undefined,
        supported: true,
        options: [],
        offered: true,
        readOnly: false,
      },
      undefined
    )?.fields.find(field => field.name === "picture");
    // The image controls read a file's own alt text only from a file field.
    expect(
      boundField(binding, from ?? { name: undefined, fields: undefined })?.type
    ).toBe("upload");
    expect(listed?.type).toBe("upload");
  });
});

describe("a setting whose id holds a dot, named by its whole id", () => {
  const dotted = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [block("pic", undefined), block("h", "")],
    exposed: [setting("hero.picture", "Hero picture", "pic", "media", "image")],
  } as BlockDocument;
  const binding = { $bind: "hero.picture", source: "setting" } as const;

  it("finds the setting's field, not a nested one", () => {
    const from = settingBoundFrom(binding, dotted);
    expect(
      boundField(binding, from ?? { name: undefined, fields: undefined })
    ).toMatchObject({ name: "hero.picture", type: "upload" });
  });

  it("names it by its label on the chip", () => {
    const from = settingBoundFrom(binding, dotted);
    expect(
      boundNames(binding, from ?? { name: undefined, fields: undefined }, {
        prop: "media",
      })
    ).toEqual({ field: "Hero picture", source: "This component's settings" });
  });
});
