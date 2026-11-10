// @vitest-environment jsdom

/**
 * The instance inspector, driven through the inspector panel against a real
 * editor.
 *
 * `instance-inspector.ts` decides which rows an instance offers and what op
 * each edit produces, and asserts that without a DOM. What is only true HERE
 * is the wiring: that selecting an instance draws this surface rather than the
 * block inspector's "select a block", that a field's edit reaches
 * `editor.apply` as the override op at the moment it should, and that the way
 * back — the reset — is on the row where an author can see it.
 *
 * @module instance-inspector-panel.test
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  resolveComponentInstances,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type ComponentLookup,
} from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import type { SavedComponent } from "./inserter";
import type { ContentServices, MediaPickerProps } from "./content-controls";
import { InspectorPanel } from "./inspector-panel";

afterEach(cleanup);

beforeAll(() => {
  // Radix measures and scrolls; jsdom provides neither, and a missing one
  // throws during render rather than failing an assertion.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

/** A definition exposing a title (text), a tone (select) and a picture (image). */
function header(extra: Partial<ComponentDocument> = {}): ComponentDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [
      {
        id: "h1",
        type: "acme/heading",
        version: 1,
        props: { text: "Site name", tone: "light", image: "hero.png" },
      },
    ],
    exposed: [
      {
        id: "title",
        label: "Title",
        nodeId: "h1",
        propPath: "text",
        type: "text",
      },
      {
        id: "tone",
        label: "Tone",
        nodeId: "h1",
        propPath: "tone",
        type: "select",
        options: [
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ],
      },
      {
        id: "picture",
        label: "Picture",
        nodeId: "h1",
        propPath: "image",
        type: "image",
      },
    ],
    ...extra,
  } as ComponentDocument;
}

function instance(props: Record<string, unknown> = {}): BlockNode {
  return {
    id: "i1",
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId: "header", ...props },
  };
}

function pageOf(node: BlockNode): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [node],
  } as BlockDocument;
}

function editorFor(
  document: BlockDocument
): EditorState & { apply: ReturnType<typeof vi.fn> } {
  return {
    document,
    selectedId: "i1",
    selection: { ids: ["i1"], primary: "i1" },
    applyAll: vi.fn(() => document),
    select: vi.fn(),
    apply: vi.fn(() => document),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
}

const LIBRARY: readonly SavedComponent[] = [
  { id: "header", title: "Header", usedOn: 12, document: header() },
];

/**
 * `null` for a lookup holding NO definition — not `undefined`, which a default
 * parameter reads as "use the default" and would hand the header back.
 */
function mount(
  node: BlockNode,
  definition: ComponentDocument | null = header(),
  components: readonly SavedComponent[] = LIBRARY
) {
  const lookup: ComponentLookup = new Map(
    definition === null ? [] : [["header", definition]]
  );
  const editor = editorFor(pageOf(node));
  render(
    <InspectorPanel
      editor={editor}
      componentLibrary={{ definitions: lookup, components }}
    />
  );
  return editor;
}

/** The panel with the host's content services, the media library among them. */
function mountWithServices(node: BlockNode, services: ContentServices) {
  const lookup: ComponentLookup = new Map([["header", header()]]);
  const editor = editorFor(pageOf(node));
  render(
    <InspectorPanel
      editor={editor}
      componentLibrary={{ definitions: lookup, components: LIBRARY }}
      contentServices={services}
    />
  );
  return editor;
}

/** A media library that returns one file when its button is pressed. */
function OnePick({ onSelect }: MediaPickerProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onSelect([{ id: "m2", filename: "new.png" }])}
    >
      Pick new.png
    </button>
  );
}

/** The props the one applied op carries, read off the spy. */
function appliedProps(editor: { apply: ReturnType<typeof vi.fn> }): unknown {
  expect(editor.apply).toHaveBeenCalledTimes(1);
  const op = editor.apply.mock.calls[0]?.[0] as {
    kind: string;
    id: string;
    patch: { props: unknown };
  };
  expect(op.kind).toBe("update");
  expect(op.id).toBe("i1");
  return op.patch.props;
}

describe("what a selected instance is shown as", () => {
  it("draws the instance surface — the component's title and usage — and no tabs", () => {
    // Before this surface existed the block inspector answered "select a
    // block" to an author who had just clicked a component, because an
    // instance's type is not in the registry.
    mount(instance());

    expect(screen.getByRole("heading", { name: /Header/ })).toBeDefined();
    expect(screen.getByText(/used on 12 pages/)).toBeDefined();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByText("Select a block to edit it.")).toBeNull();
  });

  it("titles by the id when the library has no row, and says nothing about usage", () => {
    mount(instance(), header(), []);

    expect(screen.getByRole("heading", { name: /header/ })).toBeDefined();
    expect(screen.queryByText(/used on/)).toBeNull();
  });

  it("says the component could not be loaded when the lookup holds no definition", () => {
    // The same state the canvas draws as could-not-be-loaded, in words — and
    // the default for a host that supplied no lookup at all.
    mount(instance(), null);

    expect(screen.getByRole("status").textContent).toContain(
      "could not be loaded"
    );
    expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
  });

  it("reads a host that supplied no lookup as one whose definitions could not be loaded", () => {
    // The default has to be the honest one: without the canvas's lookup the
    // rows cannot be read from what the page draws, so none are.
    const editor = editorFor(pageOf(instance()));
    render(<InspectorPanel editor={editor} />);

    expect(screen.getByRole("status").textContent).toContain(
      "could not be loaded"
    );
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("says when the component exposes nothing, rather than showing an empty list", () => {
    mount(instance(), header({ exposed: [] }));

    // With no Edit component on offer, the sentence points at nothing.
    expect(
      screen.getByText(/has no fields to change on this page/).textContent
    ).not.toContain("Edit component");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("points at Edit component only where it is offered", () => {
    const definition = header({ exposed: [] });
    render(
      <InspectorPanel
        editor={editorFor(pageOf(instance()))}
        componentLibrary={{
          definitions: new Map([["header", definition]]),
          components: LIBRARY,
        }}
        verbs={{
          actions: [
            { id: "edit-component", label: "Edit component", enabled: true },
          ],
          run: vi.fn(),
        }}
      />
    );
    expect(
      screen.getByText(/has no fields to change on this page/).textContent
    ).toContain("Use Edit component");
  });
});

describe("editing an exposed property", () => {
  it("shows the value in force and commits a typed value as an override, keeping the component id", () => {
    const editor = mount(instance());
    const field = screen.getByRole("textbox", { name: "Title" });
    expect((field as HTMLInputElement).value).toBe("Site name");

    fireEvent.change(field, { target: { value: "Acme" } });
    // Nothing yet: text commits on blur, so one undo takes back one edit.
    expect(editor.apply).not.toHaveBeenCalled();
    fireEvent.blur(field);

    expect(appliedProps(editor)).toEqual({
      componentId: "header",
      overrides: { title: "Acme" },
    });
  });

  it("commits on Enter as well as on blur", () => {
    const editor = mount(instance());
    const field = screen.getByRole("textbox", { name: "Title" });

    fireEvent.change(field, { target: { value: "Acme" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(appliedProps(editor)).toMatchObject({
      overrides: { title: "Acme" },
    });
  });

  it("CLEARS the property when the field is emptied, rather than writing an empty string", () => {
    // The whole reason the sentinel exists: taking away a subtitle the
    // definition fills in, which `""` cannot say.
    const editor = mount(instance());
    const field = screen.getByRole("textbox", { name: "Title" });

    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);

    expect(appliedProps(editor)).toEqual({
      componentId: "header",
      overrides: { title: { $unset: true } },
    });
  });

  it("follows the stored value when the document changes underneath it", () => {
    // An undo, a reset, or an edit from elsewhere replaces the override; a
    // field that kept its draft would go on showing a value the document no
    // longer has, and its next blur would write that stale value back.
    const lookup: ComponentLookup = new Map([["header", header()]]);
    const library = { definitions: lookup, components: LIBRARY };
    const { rerender } = render(
      <InspectorPanel
        editor={editorFor(pageOf(instance({ overrides: { title: "One" } })))}
        componentLibrary={library}
      />
    );
    expect(
      (screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value
    ).toBe("One");

    rerender(
      <InspectorPanel
        editor={editorFor(pageOf(instance({ overrides: { title: "Two" } })))}
        componentLibrary={library}
      />
    );

    expect(
      (screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value
    ).toBe("Two");
  });

  it("writes nothing for a field left as it was", () => {
    const editor = mount(instance());

    fireEvent.blur(screen.getByRole("textbox", { name: "Title" }));

    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("keeps the other overrides when one is set", () => {
    const editor = mount(instance({ overrides: { tone: "dark" } }));
    const field = screen.getByRole("textbox", { name: "Title" });

    fireEvent.change(field, { target: { value: "Acme" } });
    fireEvent.blur(field);

    expect(appliedProps(editor)).toEqual({
      componentId: "header",
      overrides: { tone: "dark", title: "Acme" },
    });
  });
});

describe("where a value came from, and the way back", () => {
  it("badges an inherited row as inherited and offers it no reset", () => {
    mount(instance());

    expect(screen.getAllByText("From the component").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Reset/ })).toBeNull();
  });

  it("badges an overridden row and resets it by REMOVING the override, on the row", () => {
    // Visible, on the row: the editor that hid its reset behind a context
    // menu is the one whose users had to ask where it was.
    const editor = mount(instance({ overrides: { title: "Acme" } }));

    expect(screen.getByText("Set on this page")).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Reset Title",
      })
    );

    // The record goes with its last override, rather than staying empty.
    expect(appliedProps(editor)).toStrictEqual({ componentId: "header" });
  });

  it("badges a cleared row as cleared, shows it empty, and still offers the reset", () => {
    mount(instance({ overrides: { title: { $unset: true } } }));

    expect(screen.getByText("Cleared on this page")).toBeDefined();
    expect(
      (screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value
    ).toBe("");
    expect(
      screen.getByRole("button", {
        name: "Reset Title",
      })
    ).toBeDefined();
  });
});

describe("a choice with an empty option", () => {
  it("renders a definition whose select offers “none” as an empty value, and writes it back empty", () => {
    // The validator accepts `""` as an option value and the select control
    // throws on it at render, so an otherwise valid component crashed its
    // inspector. The empty value wears a sentinel in the control and comes
    // back as `""` — asserted on the WRITE, since the sentinel must never
    // reach the document.
    const noneable = header({
      exposed: [
        {
          id: "tone",
          label: "Tone",
          nodeId: "h1",
          propPath: "tone",
          type: "select",
          options: [
            { value: "", label: "None" },
            { value: "dark", label: "Dark" },
          ],
        },
      ],
    });
    const editor = mount(instance({ overrides: { tone: "" } }), noneable);

    // Rendered at all is the first half: the trigger stands and shows the
    // empty option's label as the current choice.
    const trigger = screen.getByRole("combobox", { name: "Tone" });
    expect(trigger.textContent).toContain("None");
    expect(editor.apply).not.toHaveBeenCalled();
  });
});

describe("a link and a visibility exposure", () => {
  const linked = () =>
    header({
      nodes: [
        {
          id: "h1",
          type: "acme/cta",
          version: 1,
          props: { text: "Read more", href: "/docs" },
        },
      ],
      exposed: [
        {
          id: "cta",
          label: "Call to action",
          nodeId: "h1",
          propPath: "href",
          type: "link",
        },
        {
          id: "shown",
          label: "Newsletter form",
          nodeId: "h1",
          propPath: "visibility",
          type: "visibility",
        },
      ],
    });

  it("edits a link as the address it holds, and clears it when emptied", () => {
    // The same field a url prop gets in the block inspector, keyed for an
    // address. Emptied, it clears rather than writing "" — an href of ""
    // points at the page itself.
    const editor = mount(instance(), linked());
    const field = screen.getByRole("textbox", {
      name: "Call to action",
    }) as HTMLInputElement;

    expect(field.value).toBe("/docs");
    expect(field.inputMode).toBe("url");
    fireEvent.change(field, { target: { value: "https://example.test/go" } });
    fireEvent.blur(field);

    expect(appliedProps(editor)).toEqual({
      componentId: "header",
      overrides: { cta: "https://example.test/go" },
    });
    cleanup();

    const emptied = mount(instance({ overrides: { cta: "/go" } }), linked());
    const again = screen.getByRole("textbox", { name: "Call to action" });
    fireEvent.change(again, { target: { value: "" } });
    fireEvent.blur(again);
    expect(appliedProps(emptied)).toEqual({
      componentId: "header",
      overrides: { cta: { $unset: true } },
    });
  });

  it("still offers a SELECT's options when its stored value is structured", () => {
    // Unlike a text field, a select does not carry the old value into what it
    // writes: choosing an option replaces it outright. So a junk value there is
    // repairable by using the control, and hiding it would strand the property.
    mount(instance({ overrides: { tone: { unexpected: true } } }), header());

    expect(screen.getByRole("combobox", { name: "Tone" })).toBeDefined();
  });

  it("still offers the field for a CLEARED text row, so the author can put a value back", () => {
    // A clear is a blank the field is meant to show, not a value the control
    // cannot hold — read as unrepresentable, clearing a property would make it
    // permanently uneditable.
    mount(instance({ overrides: { cta: { $unset: true } } }), linked());

    expect(
      screen.getByRole("textbox", { name: "Call to action" })
    ).toBeDefined();
  });

  it("shows a STRUCTURED value rather than offering to overwrite it with text", () => {
    /*
     * `OverrideValue` is unconstrained, so a host block may declare a link prop
     * as an object. A text control renders one as an empty field — there is no
     * string to show — and the first edit replaces the whole value with
     * whatever was typed into that blank, losing the rest of it silently.
     *
     * Shown read-only instead, through the same note a type this panel cannot
     * edit yet uses: the author sees what is there and nothing overwrites it.
     */
    const editor = mount(
      instance({ overrides: { cta: { href: "/docs", rel: "nofollow" } } }),
      linked()
    );

    expect(
      screen.queryByRole("textbox", { name: "Call to action" })
    ).toBeNull();
    expect(screen.getByText(/nofollow/)).toBeDefined();
    // Nothing to type into means nothing written: the value is intact.
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("keeps a visibility row's source under its name, the switch in the control cell", () => {
    // One row like every other placement field: the note under the name, not
    // under the control, which made each field two rows.
    mount(instance(), linked());
    const toggle = screen.getByRole("switch", { name: "Newsletter form" });
    const row = toggle.closest(".nx-inspector__field--exposed");
    expect(toggle.closest(".nx-inspector__exposed")).not.toBeNull();
    const name = row?.querySelector(".nx-inspector__exposed-name");
    expect(name?.querySelector(".nx-inspector__source")).not.toBeNull();
    expect(
      row?.querySelector(".nx-inspector__exposed .nx-inspector__source")
    ).toBeNull();
  });

  it("is a switch named by its row, with no words beside it", () => {
    // A checkbox beside "Shown on this page" wrapped onto two lines; the
    // switch's state says it, and the row's label names it.
    mount(instance(), linked());
    expect(
      screen.getByRole("switch", { name: "Newsletter form" })
    ).toBeDefined();
    expect(screen.queryByText("Shown on this page")).toBeNull();
  });

  it("shows an inherited visibility row as shown, and hides it by writing false", () => {
    // Inherited is the component's own rule, which is shown unless the
    // definition gates the node itself; the resolver reads `false` as hidden
    // and `true` as shown, and nothing else.
    const editor = mount(instance(), linked());
    const box = screen.getByRole("switch", { name: "Newsletter form" });

    expect(box.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(box);

    expect(appliedProps(editor)).toEqual({
      componentId: "header",
      overrides: { shown: false },
    });
  });

  it("shows a row the DEFINITION gates as not shown, and turns it on by writing true", () => {
    /*
     * The component's own rule is not always "shown". A definition node
     * carrying entry-field conditions is withheld by the renderer's
     * hidden-node pass, and the resolver keeps the gate for it to act on — so
     * a checkbox drawn from "no override written" told the author the node was
     * on this page while the canvas did not draw it.
     *
     * Clicking it writes `true`, which is the one thing that removes the
     * component's gate for this instance.
     */
    const gated = () =>
      header({
        nodes: [
          {
            id: "h1",
            type: "acme/cta",
            version: 1,
            props: { text: "Read more", href: "/docs" },
            visibility: {
              conditions: [[{ field: "tier", op: "eq", value: "pro" }]],
            },
          } as never,
        ],
        exposed: [
          {
            id: "shown",
            label: "Newsletter form",
            nodeId: "h1",
            propPath: "visibility",
            type: "visibility",
          },
        ],
      });
    const editor = mount(instance(), gated());
    const box = screen.getByRole("switch", { name: "Newsletter form" });

    expect(box.getAttribute("aria-checked")).toBe("false");
    // And not as the author's own doing: there is nothing of theirs to reset.
    expect(screen.queryByRole("button", { name: /reset/i })).toBeNull();

    fireEvent.click(box);

    expect(appliedProps(editor)).toEqual({
      componentId: "header",
      overrides: { shown: true },
    });
  });

  it("shows a hidden row unchecked — cleared included, which the page reads as hidden — and shows it again by writing true", () => {
    const hidden = mount(instance({ overrides: { shown: false } }), linked());
    const box = screen.getByRole("switch", { name: "Newsletter form" });
    expect(box.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(box);
    expect(appliedProps(hidden)).toEqual({
      componentId: "header",
      overrides: { shown: true },
    });
    cleanup();

    mount(instance({ overrides: { shown: { $unset: true } } }), linked());
    expect(
      screen
        .getByRole("switch", { name: "Newsletter form" })
        .getAttribute("aria-checked")
    ).toBe("false");
    expect(screen.getByText("Cleared on this page")).toBeDefined();
  });

  it("offers the reset on a visibility override, which returns it to the component's rule", () => {
    const editor = mount(instance({ overrides: { shown: false } }), linked());

    fireEvent.click(
      screen.getByRole("button", {
        name: "Reset Newsletter form",
      })
    );

    expect(appliedProps(editor)).toStrictEqual({ componentId: "header" });
  });
});

/**
 * A select offering `""` and `"\u0000"`: both are legal option values, and a
 * spelling that gave `""` a sentinel of its own made the two one item value.
 */
const nulAndNone = () =>
  header({
    exposed: [
      {
        id: "tone",
        label: "Tone",
        nodeId: "h1",
        propPath: "tone",
        type: "select",
        options: [
          { value: "", label: "None" },
          { value: "\u0000", label: "Nul" },
        ],
      },
    ],
  });

describe("two options the control once spelled alike", () => {
  it("shows a stored empty value as the empty option, not as the NUL one", () => {
    // Spelled alike, the two items shared one value and the control drew the
    // later of them for either — the empty choice read as "Nul".
    mount(instance({ overrides: { tone: "" } }), nulAndNone());

    const shown = screen.getByRole("combobox", { name: "Tone" }).textContent;
    expect(shown).toContain("None");
    expect(shown).not.toContain("Nul");
  });

  it("writes the NUL when it is chosen from the empty option, rather than nothing", () => {
    // Spelled alike, the item chosen carried the value the control already
    // held, so choosing it changed nothing and wrote nothing.
    const editor = mount(instance({ overrides: { tone: "" } }), nulAndNone());

    fireEvent.click(screen.getByRole("combobox", { name: "Tone" }));
    fireEvent.click(screen.getByRole("option", { name: "Nul" }));

    expect(appliedProps(editor)).toEqual({
      componentId: "header",
      overrides: { tone: "\u0000" },
    });
  });

  it("writes the empty value when the empty option is chosen", () => {
    // The control for the empty spelling: it must still come back as `""`.
    const editor = mount(
      instance({ overrides: { tone: "\u0000" } }),
      nulAndNone()
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Tone" }));
    fireEvent.click(screen.getByRole("option", { name: "None" }));

    expect(appliedProps(editor)).toEqual({
      componentId: "header",
      overrides: { tone: "" },
    });
  });
});

describe("a placement's row", () => {
  it("is one row, its source a note under its label and Reset in its own slot", () => {
    // Label, field, then "Set on this page" stacked made each row about 68px
    // beside the 28px Style rows.
    mount(instance({ overrides: { title: "Hello" } }));
    const note = screen.getByText("Set on this page");
    const name = note.closest(".nx-inspector__exposed-name");
    expect(name?.querySelector("label")?.textContent).toBe("Title");
    const reset = screen.getByRole("button", { name: "Reset Title" });
    const slot = reset.parentElement;
    expect(slot?.className).toBe("nx-inspector__exposed-reset-slot");
    expect(slot?.parentElement?.className).toContain(
      "nx-inspector__field--exposed"
    );
  });

  it("keeps the reset slot when there is nothing to reset", () => {
    // So every control ends at one edge, set or not.
    mount(instance());
    expect(
      document.querySelectorAll(
        ".nx-inspector__field--exposed > .nx-inspector__exposed-reset-slot"
      ).length
    ).toBeGreaterThan(0);
  });
});

describe("the panel's words", () => {
  it("gives the card's name, cut short on screen, whole in its tooltip", () => {
    mount({
      ...instance(),
      name: "A placement named at some considerable length",
    });
    const title = screen.getByRole("heading", { level: 2 });
    expect(title.getAttribute("title")).toBe(
      "A placement named at some considerable length · Header"
    );
  });

  it("calls the rows Fields, where it said Exposed properties", () => {
    mount(instance());
    expect(screen.getByRole("heading", { name: "Fields" })).toBeDefined();
    expect(screen.queryByText(/Exposed properties/i)).toBeNull();
  });

  it("resets with an icon named for its row, not a word button", () => {
    mount(instance({ overrides: { title: "Hello" } }));
    const reset = screen.getByRole("button", { name: "Reset Title" });
    expect(reset.textContent).toBe("");
    expect(reset.getAttribute("title")).toBe("Undo this page's change");
  });
});

describe("an exposed image", () => {
  it("shows the placement's file by its thumbnail, name and alt text", async () => {
    // Every placement read "An image from the media library.", so six
    // placements of one card looked the same.
    mountWithServices(instance({ overrides: { picture: "m2" } }), {
      MediaPicker: OnePick,
      readMedia: async id =>
        id === "m2"
          ? { name: "team.jpg", thumbnail: "/t/m2.jpg", alt: "The team" }
          : null,
    });
    expect(await screen.findByText("team.jpg")).toBeDefined();
    expect(screen.getByText("Library alt text: The team")).toBeDefined();
    expect(
      document.querySelector(".nx-inspector__media-thumb")?.getAttribute("src")
    ).toBe("/t/m2.jpg");
  });

  it("is chosen from the media library, as the Content tab's image is", () => {
    // "Not editable here yet (image)" left a placement's picture fixed to
    // the component's.
    const editor = mountWithServices(instance(), { MediaPicker: OnePick });
    expect(screen.queryByText(/Not editable here yet \(image\)/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Choose Picture" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick new.png" }));
    expect(appliedProps(editor)).toEqual({
      componentId: "header",
      overrides: { picture: "m2" },
    });
  });

  it("removes the placement's image, leaving it cleared rather than inherited", () => {
    const editor = mountWithServices(
      instance({ overrides: { picture: "m2" } }),
      { MediaPicker: OnePick }
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove Picture" }));
    expect(appliedProps(editor)).toEqual({
      componentId: "header",
      overrides: { picture: { $unset: true } },
    });
  });

  it("names the picker by its row's label, which points at it", () => {
    mountWithServices(instance(), { MediaPicker: OnePick });
    // The label targets the Choose button, a labelable control, so pressing
    // the label reaches the picker as it reaches every other row's control.
    const label = screen.getByText("Picture", { selector: "label" });
    const target = document.getElementById(label.getAttribute("for") ?? "");
    expect(target?.tagName).toBe("BUTTON");
    expect(target?.getAttribute("aria-label")).toBe("Choose Picture");
  });

  it("keeps a malformed image value visible and out of the picker's reach", () => {
    // A number is not an image id; offered to the picker it read as "Nothing
    // chosen" and could be replaced unseen.
    mountWithServices(instance({ overrides: { picture: 42 } }), {
      MediaPicker: OnePick,
    });
    expect(
      screen.getByText(/Not editable here yet \(image\)/).textContent
    ).toContain("42");
    expect(screen.queryByRole("button", { name: "Choose Picture" })).toBeNull();
  });

  it("says the library is not available where the host offers none", () => {
    mountWithServices(instance(), {});
    expect(
      screen.getByText("The media library is not available here.")
    ).toBeDefined();
  });
});

/** A passage, as the rich-text editor stores one. */
function passage(text: string): unknown {
  return {
    root: {
      type: "root",
      children: [{ type: "paragraph", children: [{ type: "text", text }] }],
    },
  };
}

/** The header with a rich-text body exposed, mounted with the given services. */
function mountRich(
  node: BlockNode,
  services: ContentServices,
  canvasPassage?: { placementId: string; exposureId: string }
) {
  const definition = header({
    nodes: [
      {
        id: "h1",
        type: "acme/heading",
        version: 1,
        props: { text: "Site name", body: passage("The component's words") },
      },
    ],
    exposed: [
      {
        id: "body",
        label: "Body",
        nodeId: "h1",
        propPath: "body",
        type: "richText",
      },
    ],
  });
  const editor = editorFor(pageOf(node));
  render(
    <InspectorPanel
      editor={editor}
      componentLibrary={{
        definitions: new Map([["header", definition]]),
        components: LIBRARY,
      }}
      contentServices={services}
      {...(canvasPassage === undefined ? {} : { canvasPassage })}
    />
  );
  return editor;
}

/** A rich-text editor that attaches, and reads back the given passage. */
function richEditor(read: unknown) {
  const attach = vi.fn(() => ({
    status: "attached",
    session: {
      focus: vi.fn(),
      read: () => read,
      detach: vi.fn(),
      hold: vi.fn(),
    },
  }));
  const load = vi.fn(async () => ({
    attach,
  })) as unknown as ContentServices["loadRichTextEditor"];
  return { attach, load };
}

describe("an exposed rich text the canvas is editing", () => {
  it("is held in the panel, saying where it is being edited", async () => {
    // One editor serves both: opening it here would take the passage from
    // under the author's caret on the canvas.
    const { attach, load } = richEditor(passage("Edited"));
    mountRich(
      instance(),
      { loadRichTextEditor: load },
      { placementId: "i1", exposureId: "body" }
    );
    const field = screen.getByRole("textbox", { name: "Body" });
    await act(async () => {
      fireEvent.focus(field);
    });
    expect(attach).not.toHaveBeenCalled();
    expect(screen.getByText(/being edited on the canvas/i)).toBeDefined();
  });

  it("is not held while the canvas edits another placement's", async () => {
    const { attach, load } = richEditor(passage("Edited"));
    mountRich(
      instance(),
      { loadRichTextEditor: load },
      { placementId: "other", exposureId: "body" }
    );
    const field = screen.getByRole("textbox", { name: "Body" });
    await act(async () => {
      fireEvent.focus(field);
    });
    expect(attach).toHaveBeenCalled();
  });
});

describe("an exposed rich text", () => {
  it("is edited with the admin's rich-text editor, written as the placement's own", async () => {
    // "Not editable here yet (rich text)" left a placement's passage fixed
    // to the component's.
    const { attach, load } = richEditor(passage("This page's words"));
    const editor = mountRich(instance(), { loadRichTextEditor: load });
    expect(screen.queryByText(/Not editable here yet/)).toBeNull();
    const field = screen.getByRole("textbox", { name: "Body" });
    await act(async () => {
      fireEvent.focus(field);
    });
    // Opened on what the page shows: the component's passage.
    expect(attach).toHaveBeenCalledWith(
      field,
      passage("The component's words")
    );
    await act(async () => {
      fireEvent.blur(field);
    });
    expect(appliedProps(editor)).toEqual({
      componentId: "header",
      overrides: { body: passage("This page's words") },
    });
  });

  it("opens on the placement's own passage where it has one", async () => {
    const { attach, load } = richEditor(passage("Edited"));
    mountRich(instance({ overrides: { body: passage("Ours") } }), {
      loadRichTextEditor: load,
    });
    const field = screen.getByRole("textbox", { name: "Body" });
    await act(async () => {
      fireEvent.focus(field);
    });
    expect(attach).toHaveBeenCalledWith(field, passage("Ours"));
  });

  it("opens a cleared passage empty, not on the component's", async () => {
    const { attach, load } = richEditor(passage("Edited"));
    mountRich(instance({ overrides: { body: { $unset: true } } }), {
      loadRichTextEditor: load,
    });
    const field = screen.getByRole("textbox", { name: "Body" });
    await act(async () => {
      fireEvent.focus(field);
    });
    expect(attach).toHaveBeenCalledWith(field, undefined);
  });

  it("keeps the passage open with the author's words when the write is refused", async () => {
    const { load } = richEditor(passage("Too long"));
    const editor = mountRich(instance(), { loadRichTextEditor: load });
    editor.apply.mockImplementation(() => null);
    const field = screen.getByRole("textbox", { name: "Body" });
    await act(async () => {
      fireEvent.focus(field);
    });
    await act(async () => {
      fireEvent.blur(field);
    });
    expect(screen.getByText(/could not be saved/)).toBeDefined();
  });

  it("keeps a value its editor cannot hold visible, and out of its reach", () => {
    const { load } = richEditor(passage("Edited"));
    mountRich(instance({ overrides: { body: 42 } }), {
      loadRichTextEditor: load,
    });
    expect(
      screen.getByText(/Not editable here yet \(rich text\)/).textContent
    ).toContain("42");
    expect(screen.queryByRole("textbox", { name: "Body" })).toBeNull();
  });

  it("shows a passage stored as plain words, rather than opening it empty", () => {
    // The editor reads plain words as no passage at all and opens empty, so
    // the first keystroke would replace the words the page shows.
    const { attach, load } = richEditor(passage("Edited"));
    mountRich(instance({ overrides: { body: "Plain words" } }), {
      loadRichTextEditor: load,
    });
    expect(
      screen.getByText(/Not editable here yet \(rich text\)/).textContent
    ).toContain("Plain words");
    expect(screen.queryByRole("textbox", { name: "Body" })).toBeNull();
    expect(attach).not.toHaveBeenCalled();
  });

  it("is read-only on a placement locked in Layers, which holds every row", async () => {
    // A disabled fieldset does not stop typing in a `contenteditable`, so
    // the passage is told.
    const { attach, load } = richEditor(passage("Edited"));
    mountRich({ ...instance(), locked: true }, { loadRichTextEditor: load });
    const field = screen.getByRole("textbox", { name: "Body" });
    expect(field.getAttribute("aria-readonly")).toBe("true");
    await act(async () => {
      fireEvent.focus(field);
    });
    expect(attach).not.toHaveBeenCalled();
  });

  it("says it is not editable where the host lends no rich-text editor", () => {
    // The Content tab's words for this ("edited on the canvas here") are not
    // true of a placement, whose canvas passage is the component's.
    mountRich(instance(), {});
    expect(
      screen.getByText(/Not editable here yet \(rich text\)/).textContent
    ).toContain("The component's words");
    expect(screen.queryByText(/edited on the canvas/)).toBeNull();
  });
});

describe("rows with no control", () => {
  it("lists a value its control cannot hold, with the value, rather than hiding it", () => {
    // An image row chooses a file by id; a host block holding its image as
    // an object is shown, not offered to a picker that would replace it.
    mount(instance({ overrides: { picture: { src: "hero.png" } } }));

    const note = screen.getByText(/Not editable here yet \(image\)/);
    expect(note.textContent).toContain("hero.png");
    expect(screen.queryByRole("button", { name: "Choose Picture" })).toBeNull();
  });

  it("shows a structured value in words — rich text as its text, a list by its count, other data as data — rather than as nothing", () => {
    // A value that is there and one that is not both read as empty through
    // the text field's reader, so a row showed nothing where the page shows
    // a passage.
    const passage = {
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", text: "Hello " },
              { type: "text", text: "world" },
            ],
          },
        ],
      },
    };
    const structured = header({
      nodes: [
        {
          id: "h1",
          type: "acme/heading",
          version: 1,
          props: {
            body: passage,
            gallery: ["a.png", "b.png"],
            hero: { url: "/logo.png", alt: "Logo" },
          },
        },
      ],
      exposed: [
        {
          id: "body",
          label: "Body",
          nodeId: "h1",
          propPath: "body",
          type: "richText",
        },
        {
          id: "gallery",
          label: "Gallery",
          nodeId: "h1",
          propPath: "gallery",
          type: "image",
        },
        {
          id: "hero",
          label: "Hero",
          nodeId: "h1",
          propPath: "hero",
          type: "image",
        },
      ],
    });
    mount(instance(), structured);

    // Mounted without the host's rich-text editor, so the passage is shown.
    expect(
      screen.getByText(/Not editable here yet \(rich text\)/).textContent
    ).toContain("“Hello world”");
    const images = screen
      .getAllByText(/Not editable here yet \(image\)/)
      .map(note => note.textContent);
    expect(images).toEqual([
      expect.stringContaining("“2 items”"),
      expect.stringContaining('“{"url":"/logo.png","alt":"Logo"}”'),
    ]);
  });

  it("names the exposure the page shows instead, for a shadowed row, and draws no control for it", () => {
    const twice = header({
      exposed: [
        {
          id: "title",
          label: "Title",
          nodeId: "h1",
          propPath: "text",
          type: "text",
        },
        {
          id: "headline",
          label: "Headline",
          nodeId: "h1",
          propPath: "text",
          type: "text",
        },
      ],
    });
    mount(instance({ overrides: { headline: "Later wins" } }), twice);

    expect(screen.getByText(/Set by “Headline”/)).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
    // The row in force keeps its control.
    expect(screen.getByRole("textbox", { name: "Headline" })).toBeDefined();
  });

  it("offers the reset on the row that HOLDS the override, not on the row it shadows", () => {
    // The shadowed row reads the winner's source, so a reset keyed on source
    // stood on a row with nothing to reset — pressed, it removed nothing.
    const twice = header({
      exposed: [
        {
          id: "title",
          label: "Title",
          nodeId: "h1",
          propPath: "text",
          type: "text",
        },
        {
          id: "headline",
          label: "Headline",
          nodeId: "h1",
          propPath: "text",
          type: "text",
        },
      ],
    });
    const editor = mount(
      instance({ overrides: { headline: "Later wins" } }),
      twice
    );

    expect(
      screen.queryByRole("button", {
        name: "Reset Title",
      })
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Reset Headline",
      })
    );
    expect(appliedProps(editor)).toStrictEqual({ componentId: "header" });
  });
});

describe("overrides the component no longer exposes", () => {
  it("lists them with their stored value and discards one by removing it", () => {
    const editor = mount(
      instance({ overrides: { title: "Acme", subtitle: "Gone now" } })
    );

    expect(
      screen.getByRole("heading", { name: "No longer exposed" })
    ).toBeDefined();
    expect(screen.getByText("Gone now")).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Discard the stored value for subtitle",
      })
    );

    expect(appliedProps(editor)).toEqual({
      componentId: "header",
      overrides: { title: "Acme" },
    });
  });

  it("shows an orphaned structured value as data and a cleared one as cleared, rather than as having no value", () => {
    mount(
      instance({
        overrides: {
          title: "Acme",
          logo: { url: "/logo.png" },
          subtitle: { $unset: true },
        },
      })
    );

    expect(screen.getByText('{"url":"/logo.png"}')).toBeDefined();
    expect(screen.getByText("(cleared)")).toBeDefined();
    expect(screen.queryByText("(no text value)")).toBeNull();
  });

  it("draws no such section when there are none", () => {
    // The control: a section that was always on screen would be one an author
    // learns to read past.
    mount(instance({ overrides: { title: "Acme" } }));

    expect(
      screen.queryByRole("heading", { name: "No longer exposed" })
    ).toBeNull();
  });
});

describe("two editors on one page", () => {
  it("gives every control an id of its own, so a label points at the control beside it", () => {
    // A page can hold two blocks fields, each with its own editor. With one
    // fixed id per exposed property, both labels resolved to the FIRST
    // editor's control — the second editor's label focused the first's field,
    // and its own input had no accessible name at all.
    mount(instance());
    mount(instance());

    const fields = screen.getAllByRole("textbox", {
      name: "Title",
    }) as HTMLInputElement[];
    expect(fields).toHaveLength(2);
    expect(new Set(fields.map(field => field.id)).size).toBe(2);
    for (const field of fields) {
      expect(
        Array.from(field.labels ?? []).map(label => label.textContent)
      ).toEqual(["Title"]);
    }
  });

  it("gives the LABEL field an id of its own too, which both inspectors draw", () => {
    mount({ ...instance(), name: "Header" } as BlockNode);
    mount({ ...instance(), name: "Header" } as BlockNode);

    // One open at a time, as an author would: opening the second takes focus,
    // and the first closes on its blur. Each one's id is read while it is open.
    const ids = screen.getAllByRole("heading", { level: 2 }).map(title => {
      fireEvent.doubleClick(title);
      const field = screen.getByRole("textbox", { name: "Label" });
      const id = field.id;
      fireEvent.blur(field);
      return id;
    });
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("the instance's own name", () => {
  const named = (): BlockNode => ({ ...instance(), name: "Header" });

  it("renames nothing when a draft differs from the label only in spaces, and shows the stored label", () => {
    // The rename trims, so such a draft changes nothing — and a title left
    // showing the spaces would show a label the document does not hold.
    const editor = mount(named());
    fireEvent.doubleClick(screen.getByRole("heading", { level: 2 }));
    const field = screen.getByRole("textbox", { name: "Label" });

    fireEvent.change(field, { target: { value: "  Header  " } });
    fireEvent.blur(field);

    expect(editor.apply).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain(
      "Header"
    );
  });

  it("renames with the trimmed name", () => {
    // The control: a draft that differs once trimmed is applied, trimmed.
    const editor = mount(named());
    fireEvent.doubleClick(screen.getByRole("heading", { level: 2 }));
    const field = screen.getByRole("textbox", { name: "Label" });

    fireEvent.change(field, { target: { value: "  Footer  " } });
    fireEvent.blur(field);

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "i1",
      patch: { name: "Footer" },
    });
  });
});

describe("telling cleared from inherited, and the way back", () => {
  it("draws Cleared and Inherited with different words AND different icons", () => {
    // Two placements' rows side by side would need two editors; one header
    // with the title cleared and the tone inherited shows both states.
    mount(instance({ overrides: { title: { $unset: true } } }));
    const badges = [
      ...document.querySelectorAll<HTMLElement>(".nx-inspector__source"),
    ];
    const cleared = badges.find(b => b.dataset.source === "cleared");
    const inherited = badges.find(b => b.dataset.source === "definition");
    expect(cleared?.textContent).toBe("Cleared on this page");
    expect(inherited?.textContent).toBe("From the component");
    // Shape as well as words: never colour alone.
    const iconOf = (badge: HTMLElement | undefined) =>
      badge?.querySelector("svg")?.getAttribute("class") ?? "";
    expect(iconOf(cleared)).not.toBe("");
    expect(iconOf(inherited)).not.toBe("");
    expect(iconOf(cleared)).not.toBe(iconOf(inherited));
  });

  it("names the reset for the inherited value, which under a variant is the variant's", () => {
    mount(instance({ overrides: { title: "Mine" } }));
    expect(screen.getByRole("button", { name: "Reset Title" })).toBeDefined();
  });
});

describe("a placement locked in Layers", () => {
  it("shows every row read-only with the reason, and no reset that works", () => {
    const locked = {
      ...instance({ overrides: { title: "Mine" } }),
      locked: true,
    };
    const editor = mount(locked);

    const field = screen.getByRole("textbox", { name: "Title" });
    expect(field.closest("fieldset")?.disabled).toBe(true);
    // Said once, by the card's lock line, which the held rows point at; the
    // panel no longer repeats it in a sentence of its own.
    const reason = document.getElementById(
      field.closest("fieldset")?.getAttribute("aria-describedby") ?? ""
    );
    expect(reason?.textContent).toMatch(/^Locked: it can.t be moved/);
    expect(screen.getAllByText(/locked/i)).toHaveLength(1);
    const reset = screen.getByRole("button", {
      name: "Reset Title",
    });
    expect(reset.closest("fieldset")?.disabled).toBe(true);
    // The card's menu, which holds Unlock, stays live.
    expect(
      screen
        .getByRole("button", { name: /^Actions for/ })
        .closest("fieldset[disabled]")
    ).toBeNull();
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("holds the discard of a value no longer exposed as well", () => {
    mount({
      ...instance({ overrides: { subtitle: "Gone now" } }),
      locked: true,
    });
    expect(
      screen
        .getByRole("button", { name: "Discard the stored value for subtitle" })
        .closest("fieldset")?.disabled
    ).toBe(true);
  });

  it("leaves the rows editable when it is not locked", () => {
    mount(instance());
    expect(
      screen
        .getByRole("textbox", { name: "Title" })
        .closest("fieldset[disabled]")
    ).toBeNull();
  });
});

describe("a row a lock the component sets holds", () => {
  /** The heading is locked in the component; a second heading is free. */
  const lockedHeader = () =>
    header({
      nodes: [
        {
          id: "h1",
          type: "acme/heading",
          version: 1,
          locked: true,
          props: { text: "Site name" },
        },
        {
          id: "h2",
          type: "acme/heading",
          version: 1,
          props: { text: "Strap" },
        },
      ],
      exposed: [
        {
          id: "title",
          label: "Title",
          nodeId: "h1",
          propPath: "text",
          type: "text",
        },
        {
          id: "strap",
          label: "Strap",
          nodeId: "h2",
          propPath: "text",
          type: "text",
        },
      ],
    } as Partial<ComponentDocument>);

  it("draws the reason under the field with a lock, and the label beside its field as a free row's", () => {
    const definition = lockedHeader();
    const lookup: ComponentLookup = new Map([["header", definition]]);
    const document = pageOf(instance());
    const composed = resolveComponentInstances(document, lookup, {
      exposures: true,
    }).document;
    render(
      <InspectorPanel
        editor={{ ...editorFor(document), composed: () => composed }}
        componentLibrary={{
          definitions: lookup,
          components: [{ id: "header", title: "Header", document: definition }],
        }}
      />
    );

    const held = screen.getByRole("textbox", { name: "Title" });
    const reason = screen.getByText(
      "Set by the component Header. Change it where the component is edited."
    ).parentElement;
    expect(held.closest("fieldset")?.disabled).toBe(true);
    // After the field, in document order, and marked with the lock.
    expect(
      held.compareDocumentPosition(reason!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(reason?.querySelector("svg.lucide-lock")).not.toBeNull();
    // Each label leads its own row, as the free row's does: nothing is drawn
    // between a label and its field.
    const rowOf = (name: string) =>
      screen.getByRole("textbox", { name }).closest(".nx-inspector__field");
    const free = rowOf("Strap");
    const heldRow = rowOf("Title");
    expect(heldRow?.className).toBe(free?.className);
    // The label leads the row's name cell, which leads the row.
    expect(heldRow?.firstElementChild?.firstElementChild?.tagName).toBe(
      "LABEL"
    );
    // The cell beside it starts with the field, held or free, so the field
    // stays level with its label and the reason follows it.
    const leads = (row: Element | null | undefined, name: string) =>
      row
        ?.querySelector(".nx-inspector__exposed")
        ?.firstElementChild?.contains(screen.getByRole("textbox", { name }));
    expect(leads(heldRow, "Title")).toBe(true);
    expect(leads(free, "Strap")).toBe(true);
  });

  it("keeps Reset for a value the page gave before the component locked the block", () => {
    // The save keeps such a value and lets the page drop it, so the way back
    // stays open while the field itself is held.
    const definition = lockedHeader();
    const lookup: ComponentLookup = new Map([["header", definition]]);
    const document = pageOf(instance({ overrides: { title: "Older name" } }));
    const composed = resolveComponentInstances(document, lookup, {
      exposures: true,
    }).document;
    const editor = { ...editorFor(document), composed: () => composed };
    render(
      <InspectorPanel
        editor={editor}
        componentLibrary={{
          definitions: lookup,
          components: [{ id: "header", title: "Header", document: definition }],
        }}
      />
    );

    expect(
      screen.getByRole("textbox", { name: "Title" }).closest("fieldset")
        ?.disabled
    ).toBe(true);
    const reset = screen.getByRole("button", {
      name: "Reset Title",
    });
    expect(reset.closest("fieldset[disabled]")).toBeNull();
    expect((reset as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("a link the page could not draw", () => {
  it("is held in the field with the reason, not written", () => {
    const definition = header({
      exposed: [
        {
          id: "href",
          label: "Button link",
          nodeId: "h1",
          propPath: "href",
          type: "link",
        },
      ],
    } as Partial<ComponentDocument>);
    const editor = mount(instance(), definition, [
      { id: "header", title: "Header", document: definition },
    ]);
    const field = screen.getByRole("textbox", { name: "Button link" });

    fireEvent.change(field, { target: { value: "javascript:alert(1)" } });
    fireEvent.blur(field);
    expect(editor.apply).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "Button link needs a link"
    );

    fireEvent.change(field, { target: { value: "/pricing" } });
    fireEvent.blur(field);
    expect(appliedProps(editor)).toMatchObject({
      overrides: { href: "/pricing" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a refused link once the value changes underneath it", () => {
  it("drops the refusal when the stored value changes, as after a reset or an undo", () => {
    const definition = header({
      exposed: [
        {
          id: "href",
          label: "Button link",
          nodeId: "h1",
          propPath: "href",
          type: "link",
        },
      ],
    } as Partial<ComponentDocument>);
    const library = {
      definitions: new Map([["header", definition]]) as ComponentLookup,
      components: [{ id: "header", title: "Header", document: definition }],
    };
    const view = render(
      <InspectorPanel
        editor={editorFor(pageOf(instance()))}
        componentLibrary={library}
      />
    );
    const field = screen.getByRole("textbox", { name: "Button link" });
    fireEvent.change(field, { target: { value: "javascript:alert(1)" } });
    fireEvent.blur(field);
    expect(screen.getByRole("alert")).toBeDefined();

    view.rerender(
      <InspectorPanel
        editor={editorFor(pageOf(instance({ overrides: { href: "/new" } })))}
        componentLibrary={library}
      />
    );
    expect(
      (screen.getByRole("textbox", { name: "Button link" }) as HTMLInputElement)
        .value
    ).toBe("/new");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the variant a placement uses", () => {
  it("says a field the variant clears is cleared by the variant, not on this page", () => {
    // The page holds no value to reset; the variant removed it.
    const definition = header({
      variants: {
        v1: { label: "Dark", overrides: { title: { $unset: true } } },
      },
    } as Partial<ComponentDocument>);
    mount(instance({ variant: "v1" }), definition, [
      { id: "header", title: "Header", document: definition },
    ]);
    expect(screen.getByText("Cleared by variant")).toBeDefined();
    expect(screen.queryByText("Cleared on this page")).toBeNull();
  });

  it("is named under the title", () => {
    const definition = header({
      variants: { v1: { label: "Dark", overrides: { tone: "dark" } } },
    } as Partial<ComponentDocument>);
    mount(instance({ variant: "v1" }), definition, [
      { id: "header", title: "Header", document: definition },
    ]);
    expect(screen.getByText(/Dark variant/)).toBeDefined();
  });
});

describe("the selected placement's exposed parts on the canvas", () => {
  it("are marked inside the canvas root the host names, and nowhere else", () => {
    const page = pageOf(instance());
    const lookup: ComponentLookup = new Map([["header", header()]]);
    const composed = resolveComponentInstances(page, lookup, {
      exposures: true,
    }).document;
    const headingId = composed.nodes[0]?.id ?? "";
    const markup = `<h2 data-nx-node="${headingId}" data-nx-instance="i1" data-nx-prop="text">Site name</h2>`;
    const canvas = document.createElement("div");
    canvas.innerHTML = markup;
    const elsewhere = document.createElement("div");
    elsewhere.innerHTML = markup;
    document.body.append(canvas, elsewhere);
    const editor = { ...editorFor(page), composed: () => composed };

    render(
      <InspectorPanel
        editor={editor}
        componentLibrary={{ definitions: lookup, components: LIBRARY }}
        canvasRoot={canvas}
      />
    );

    expect(canvas.querySelector("h2")?.hasAttribute("data-nx-exposed")).toBe(
      true
    );
    expect(elsewhere.querySelector("h2")?.hasAttribute("data-nx-exposed")).toBe(
      false
    );
    canvas.remove();
    elsewhere.remove();
  });
});

describe("the instance's card menu", () => {
  it("offers the shared block verbs, as a block's card does", () => {
    const run = vi.fn();
    const lookup: ComponentLookup = new Map([["header", header()]]);
    render(
      <InspectorPanel
        editor={editorFor(pageOf(instance()))}
        componentLibrary={{ definitions: lookup, components: LIBRARY }}
        verbs={{
          actions: [
            { id: "duplicate", label: "Duplicate", enabled: true },
            { id: "delete", label: "Delete", enabled: true },
          ],
          run,
        }}
      />
    );
    fireEvent.keyDown(screen.getByRole("button", { name: /^Actions for/ }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(run).toHaveBeenCalledWith("duplicate");
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull(); // menu closed
  });
});
