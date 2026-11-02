// @vitest-environment jsdom

/**
 * A component's variants in its own view, over a real editor store.
 *
 * `component-variants` decides what an edit does and is asserted without a
 * DOM. What is only true HERE is the wiring: that the section is listed with
 * nothing selected, that a new variant opens with its name ready to type
 * over, that a value set on a variant is one undo step, and that a delete
 * waits for the dialog, which says the count the host gives.
 *
 * @module component-variants-panel.test
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  DOCUMENT_FORMAT_VERSION,
  type ComponentDocument,
} from "@nextlyhq/blocks-engine";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ComponentVariantsHost, VariantUse } from "./component-variants";
import { useEditorState, type EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

afterEach(() => {
  cleanup();
});

function component(
  envelope: Partial<ComponentDocument> = {}
): ComponentDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [
      {
        id: "h1",
        type: "core/heading",
        version: 1,
        props: { text: "Plain card" },
      },
    ],
    exposed: [
      {
        id: "headline",
        label: "Headline",
        nodeId: "h1",
        propPath: "text",
        type: "text",
      },
    ],
    ...envelope,
  };
}

function mount(document: ComponentDocument, host?: ComponentVariantsHost) {
  const seen: { editor?: EditorState } = {};
  function Host() {
    const editor = useEditorState({ initialDocument: document });
    seen.editor = editor;
    return <InspectorPanel editor={editor} componentVariants={host} />;
  }
  render(<Host />);
  return () => seen.editor!;
}

const variantsOf = (editor: EditorState) =>
  (editor.document as ComponentDocument).variants;

function section(): HTMLElement {
  return screen.getByRole("region", { name: "Variants" });
}

describe("a component's variants in its own view", () => {
  it("adds one with its name ready to type over, as one undo step", () => {
    const editor = mount(component());
    fireEvent.click(
      within(section()).getByRole("button", { name: "Add variant" })
    );

    const name = within(section()).getByRole("textbox", {
      name: "Name of the variant Variant 1",
    });
    expect(document.activeElement).toBe(name);
    expect(Object.values(variantsOf(editor()) ?? {})).toEqual([
      { label: "Variant 1", overrides: {} },
    ]);
    expect(section().textContent).toContain("(no changes)");
    expect(editor().undoDepth).toBe(1);

    fireEvent.change(name, { target: { value: "Featured" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(Object.values(variantsOf(editor()) ?? {})).toEqual([
      { label: "Featured", overrides: {} },
    ]);
  });

  it("sets a value on the open variant, shown as set by it", () => {
    const editor = mount(
      component({ variants: { a: { label: "Night", overrides: {} } } })
    );
    fireEvent.click(
      within(section()).getByRole("button", {
        name: "Show the values of Night",
      })
    );
    const value = within(section()).getByRole("textbox", { name: "Headline" });
    expect(value).toHaveProperty("value", "Plain card");
    fireEvent.change(value, { target: { value: "Late edition" } });
    fireEvent.keyDown(value, { key: "Enter" });

    expect(variantsOf(editor())).toEqual({
      a: { label: "Night", overrides: { headline: "Late edition" } },
    });
    expect(section().textContent).toContain("Set by variant");
    expect(section().textContent).toContain("1 value");
  });

  it("sets a choice and hides a part on the open variant", () => {
    const base = component();
    const editor = mount({
      ...base,
      exposed: [
        ...(base.exposed ?? []),
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
          id: "shown",
          label: "Shown",
          nodeId: "h1",
          propPath: "visibility",
          type: "visibility",
        },
      ],
      variants: { a: { label: "Night", overrides: {} } },
    });
    fireEvent.click(
      within(section()).getByRole("button", {
        name: "Show the values of Night",
      })
    );
    fireEvent.click(within(section()).getByRole("combobox", { name: "Tone" }));
    fireEvent.click(screen.getByRole("option", { name: "Dark" }));
    fireEvent.click(within(section()).getByRole("switch", { name: "Shown" }));

    expect(variantsOf(editor())?.a?.overrides).toEqual({
      tone: "dark",
      shown: false,
    });
  });

  it("says why a taken name is refused, and keeps the old one", () => {
    const editor = mount(
      component({
        variants: {
          a: { label: "Dark", overrides: {} },
          b: { label: "Light", overrides: {} },
        },
      })
    );
    const name = within(section()).getByRole("textbox", {
      name: "Name of the variant Light",
    });
    fireEvent.change(name, { target: { value: "DARK" } });
    fireEvent.blur(name);

    expect(within(section()).getByRole("alert").textContent).toContain(
      "There is already a variant called “Dark”"
    );
    expect(name).toHaveProperty("value", "Light");
    expect(variantsOf(editor())?.b?.label).toBe("Light");
  });

  it("deletes only once confirmed, saying the host's count", async () => {
    const editor = mount(
      component({ variants: { a: { label: "Night", overrides: {} } } }),
      {
        countUse: async () => ({
          placements: 3,
          documents: 2,
          complete: false,
        }),
      }
    );
    fireEvent.click(
      within(section()).getByRole("button", {
        name: "Delete the variant Night",
      })
    );
    const dialog = screen.getByRole("dialog", {
      name: "Delete the variant “Night”?",
    });
    await waitFor(() =>
      expect(dialog.textContent).toContain(
        "Used by at least 3 placements in 2 documents."
      )
    );
    expect(variantsOf(editor())).toBeDefined();

    act(() => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Delete variant" })
      );
    });
    expect(variantsOf(editor())).toBeUndefined();
    expect(section().textContent).toContain("No variants yet");
  });

  it("holds the delete while the count is out", async () => {
    let answer: (use: VariantUse) => void = () => {};
    mount(component({ variants: { a: { label: "Night", overrides: {} } } }), {
      countUse: () =>
        new Promise<VariantUse>(resolve => {
          answer = resolve;
        }),
    });
    fireEvent.click(
      within(section()).getByRole("button", {
        name: "Delete the variant Night",
      })
    );
    const dialog = screen.getByRole("dialog", {
      name: "Delete the variant “Night”?",
    });
    const confirm = within(dialog).getByRole("button", {
      name: "Delete variant",
    });
    expect(confirm).toHaveProperty("disabled", true);

    await act(async () => {
      answer({ placements: 0, documents: 0, complete: true });
    });
    expect(confirm).toHaveProperty("disabled", false);
  });

  it("draws a choice field whose stored options are not a list, offering none", () => {
    const base = component();
    mount({
      ...base,
      exposed: [
        {
          id: "tone",
          label: "Tone",
          nodeId: "h1",
          propPath: "tone",
          type: "select",
          options: { light: "Light" } as unknown as [],
        },
      ],
      variants: { a: { label: "Night", overrides: {} } },
    });
    fireEvent.click(
      within(section()).getByRole("button", {
        name: "Show the values of Night",
      })
    );
    expect(
      within(section()).getByRole("combobox", { name: "Tone" })
    ).toBeDefined();
  });

  it("keeps variants listed after the last field is removed, to be deleted", () => {
    const editor = mount(
      component({
        exposed: [],
        variants: { a: { label: "Night", overrides: {} } },
      })
    );
    expect(section().textContent).toContain("Expose a field first");
    expect(
      within(section()).getByRole("button", { name: "Add variant" })
    ).toHaveProperty("disabled", true);
    fireEvent.click(
      within(section()).getByRole("button", {
        name: "Delete the variant Night",
      })
    );
    act(() => {
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Delete variant",
        })
      );
    });
    expect(variantsOf(editor())).toBeUndefined();
  });

  it("shows a cleared visibility as hidden, as the part is drawn", () => {
    const base = component();
    mount({
      ...base,
      exposed: [
        {
          id: "shown",
          label: "Shown",
          nodeId: "h1",
          propPath: "visibility",
          type: "visibility",
        },
      ],
      variants: {
        a: { label: "Night", overrides: { shown: { $unset: true } } },
      },
    });
    fireEvent.click(
      within(section()).getByRole("button", {
        name: "Show the values of Night",
      })
    );
    const toggle = within(section()).getByRole("switch", { name: "Shown" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(section().textContent).toContain("Hidden");
  });
});
