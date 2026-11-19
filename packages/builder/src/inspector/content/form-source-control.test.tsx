// @vitest-environment jsdom

/**
 * Where a Form's form comes from, as an author meets it in the Content tab:
 * with a form source (a fake provider standing in for the forms plugin), its
 * first setting picks one of the source's forms; without one, the block's
 * own fields and a hint about what the Forms plugin adds.
 *
 * @module form-source-control.test
 */
import {
  clearBlocks,
  hasBlock,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { form } from "@nextlyhq/blocks-react/blocks";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ContentServices, FormSource } from "./content-services";
import type { EditorState } from "../../editor-state";
import { useFormsShownAgain } from "./form-source-control";
import { InspectorPanel } from "../inspector-panel";

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
  clearBlocks();
});

/** The forms plugin, as a fake provider lists its forms to an author. */
const FORMS: FormSource = {
  id: "forms",
  label: "Forms",
  forms: [
    {
      ref: "1",
      title: "Request a quote",
      state: "published",
      editHref: "/admin/collections/forms/1",
    },
    { ref: "2", title: "Newsletter", state: "draft" },
    { ref: "3", title: "Event sign-up", state: "closed" },
  ],
};

function mount(
  props: Record<string, unknown>,
  services: ContentServices
): EditorState & { apply: ReturnType<typeof vi.fn> } {
  if (!hasBlock(form.name)) {
    registerBlocks([form] as never, { source: "form-source-test" });
  }
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "f", type: "core/form", version: 2, props } as BlockNode],
  } as BlockDocument;
  const editor = {
    document,
    selectedId: "f",
    selection: { ids: ["f"], primary: "f" },
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
  render(<InspectorPanel editor={editor} contentServices={services} />);
  return editor;
}

/** The props the editor was last asked to write. */
function written(editor: {
  apply: ReturnType<typeof vi.fn>;
}): Record<string, unknown> {
  const op = editor.apply.mock.calls.at(-1)?.[0] as {
    patch: { props: Record<string, unknown> };
  };
  return op.patch.props;
}

/** The Content tab's sections, in the order they are drawn. */
function sectionNames(): string[] {
  return [...document.querySelectorAll("[data-section]")].map(
    section => section.getAttribute("data-section") ?? ""
  );
}

const simple = form.defaultProps as Record<string, unknown>;

describe("a Form with a form source installed", () => {
  it("lists the forms again when the author comes back to the editor", async () => {
    let listed: FormSource[] = [{ ...FORMS, forms: [] }];
    mount(simple, { listForms: async () => listed });
    await screen.findByRole("combobox", { name: "Form" });
    // A form made in Forms' own tab, then back to the builder.
    listed = [FORMS];
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    fireEvent.click(await screen.findByRole("combobox", { name: "Form" }));
    expect(
      await screen.findByRole("option", { name: "Request a quote" })
    ).toBeDefined();
  });

  it("makes 'Form: <pick a form>' its first setting, listing the forms with drafts and closed ones marked", async () => {
    const editor = mount(simple, { listForms: async () => [FORMS] });
    const picker = await screen.findByRole("combobox", { name: "Form" });
    expect(sectionNames()[0]).toBe("Form");
    expect(picker.textContent).toBe("Pick a form");
    fireEvent.click(picker);
    expect(
      screen.getAllByRole("option").map(option => option.textContent)
    ).toEqual([
      "Request a quote",
      "Newsletter (Draft)",
      "Event sign-up (Closed)",
    ]);
    fireEvent.click(screen.getByRole("option", { name: "Newsletter (Draft)" }));
    expect(written(editor).form).toEqual({ provider: "forms", ref: "2" });
    // The block's own fields are kept for "or use a simple form".
    expect(written(editor).fields).toEqual(simple.fields);
  });

  it("says where a picked form's parts come from, links to it, and offers a simple form", async () => {
    const editor = mount(
      { ...simple, form: { provider: "forms", ref: "1" } },
      { listForms: async () => [FORMS] }
    );
    const picker = await screen.findByRole("combobox", { name: "Form" });
    expect(picker.textContent).toBe("Request a quote");
    expect(
      screen.getByText(
        "Fields, emails, spam protection and saved responses come from Forms."
      )
    ).toBeDefined();
    const edit = screen.getByRole("link", { name: "Edit this form ↗" });
    expect(edit.getAttribute("href")).toBe("/admin/collections/forms/1");
    expect(edit.getAttribute("target")).toBe("_blank");
    // The form's fields, button and destination are the provider's.
    expect(sectionNames()).not.toContain("Fields");
    expect(screen.queryByLabelText("Send to")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "or use a simple form" })
    );
    // The reference goes; the block's own fields stay as they were.
    expect(written(editor)).not.toHaveProperty("form");
    expect(written(editor).fields).toEqual(simple.fields);
  });

  it("names each source above its forms where there are several", async () => {
    mount(simple, {
      listForms: async () => [
        FORMS,
        {
          id: "acme",
          label: "Acme",
          forms: [{ ref: "a", title: "Survey", state: "published" }],
        },
      ],
    });
    fireEvent.click(await screen.findByRole("combobox", { name: "Form" }));
    expect(
      screen.getAllByRole("group").map(group => group.textContent)
    ).toEqual([
      "FormsRequest a quoteNewsletter (Draft)Event sign-up (Closed)",
      "AcmeSurvey",
    ]);
  });
});

describe("a Form with no form source", () => {
  it("edits its own fields, with a hint about what the Forms plugin adds", async () => {
    mount(simple, { listForms: async () => [] });
    expect(
      await screen.findByText(
        "Want saved responses, emails and spam protection? Install the Forms plugin. This block will then let you pick a form."
      )
    ).toBeDefined();
    expect(screen.queryByRole("combobox", { name: "Form" })).toBeNull();
    expect(sectionNames()).toContain("Fields");
    expect(screen.getByLabelText("Send to")).toBeDefined();
  });

  it("says nothing either way where the host cannot list sources", async () => {
    mount(simple, {});
    await waitFor(() => expect(sectionNames()).toContain("Fields"));
    expect(screen.queryByText(/Install the Forms plugin/)).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Form" })).toBeNull();
  });
});

describe("the round a page's picked forms are drawn in", () => {
  const page = (nodes: BlockNode[]): BlockDocument =>
    ({ kind: "page", nodes }) as unknown as BlockDocument;
  const picking = page([
    {
      id: "f",
      type: "core/form",
      version: 2,
      props: { form: { provider: "forms", ref: "7" } },
    },
  ]);
  const simpleOnly = page([
    { id: "f", type: "core/form", version: 2, props: {} },
  ]);
  const shown = (): void => {
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
  };

  it("goes up each time the author comes back to a page picking a form, and only then", async () => {
    const { result, rerender } = renderHook(
      ({ doc }: { doc: BlockDocument }) => useFormsShownAgain([doc]),
      { initialProps: { doc: simpleOnly } }
    );
    expect(result.current).toBe(0);
    // Nothing picked: coming back draws nothing again.
    shown();
    await waitFor(() => expect(result.current).toBe(0));
    // Picking a form is no return: the round holds.
    rerender({ doc: picking });
    expect(result.current).toBe(0);
    shown();
    await waitFor(() => expect(result.current).toBe(1));
    rerender({ doc: picking });
    expect(result.current).toBe(1);
  });

  it("goes up for a form picked in any tree drawn, such as a header around a page picking none", async () => {
    const { result } = renderHook(() =>
      useFormsShownAgain([simpleOnly, picking])
    );
    shown();
    await waitFor(() => expect(result.current).toBe(1));
  });
});
