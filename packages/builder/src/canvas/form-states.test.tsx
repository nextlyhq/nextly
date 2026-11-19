// @vitest-environment jsdom
/**
 * What the canvas says over a Form block: a draft, a closed and a deleted
 * picked form, each as the author's read of it says, with "Pick another
 * form" where it is closed or deleted; a simple form with nowhere to send
 * answers; and nothing over a published form, nor over one whose state
 * could not be read.
 *
 * @module canvas/form-states.test
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  ContentServices,
  FormSource,
  PickedFormState,
} from "../inspector/content/content-services";
import type { EditorState } from "../editor-state";
import { CANVAS_ROOT_CLASS } from "../shell-state";

import { FormStates } from "./form-states";

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  // jsdom lays nothing out: every element is a 320 by 180 box here.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, 320, 180)
  );
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(() => {
    const boxes = [new DOMRect(0, 0, 320, 180)];
    return Object.assign(boxes, {
      item: (i: number) => boxes[i] ?? null,
    }) as unknown as DOMRectList;
  });
});

const FORMS: FormSource = {
  id: "forms",
  label: "Forms",
  forms: [
    { ref: "1", title: "Request a quote", state: "published" },
    { ref: "2", title: "Newsletter", state: "draft" },
  ],
};

function formNode(id: string, props: Record<string, unknown>): BlockNode {
  return { id, type: "core/form", version: 2, props };
}

/** The canvas drawing `nodes` with the boxes the block draws for them. */
function mount(
  nodes: BlockNode[],
  states: Readonly<Record<string, PickedFormState | Error>>
) {
  const document: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  };
  const apply = vi.fn<EditorState["apply"]>(() => document);
  const editor = {
    document,
    selectedId: null,
    selection: { ids: [], primary: null },
    select: vi.fn(),
    apply,
    composed: () => undefined,
    lockRefusalFor: () => undefined,
  } as unknown as EditorState;
  const pickedFormState = vi.fn(async ({ ref }: { ref: string }) => {
    const state = states[ref];
    if (state === undefined || state instanceof Error) throw new Error("down");
    return state;
  });
  const services: ContentServices = {
    pickedFormState,
    listForms: async () => [FORMS],
  };
  const boxes = nodes
    .map(node =>
      // A deleted form draws an empty box where an author is looking.
      states[(node.props.form as { ref?: string } | undefined)?.ref ?? ""] ===
      "missing"
        ? `<div data-nx-node="${node.id}" data-nx-form-unavailable="missing"></div>`
        : `<form data-nx-node="${node.id}"></form>`
    )
    .join("");
  render(
    <div className={CANVAS_ROOT_CLASS}>
      <div dangerouslySetInnerHTML={{ __html: boxes }} />
      <FormStates editor={editor} services={services} />
    </div>
  );
  return { apply, pickedFormState, editor };
}

/** The editor's tab is shown or hidden, as switching tabs does. */
function tabBecomes(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** The author comes back to the editor's tab, from the form's own page. */
function comeBack(): void {
  tabBecomes("visible");
}

const picked = (ref: string) => ({ form: { provider: "forms", ref } });

describe("a picked form on the canvas", () => {
  it("says a draft is one, and nothing over a published form", async () => {
    mount([formNode("a", picked("2")), formNode("b", picked("1"))], {
      "2": "draft",
      "1": "published",
    });
    expect(
      await screen.findByText(
        "Draft form: visitors can't send it until it's published"
      )
    ).toBeTruthy();
    expect(document.querySelectorAll("[data-form-notice]")).toHaveLength(1);
    expect(
      document
        .querySelector("[data-form-notice]")
        ?.getAttribute("data-form-notice")
    ).toBe("draft");
    // A draft is still picked on purpose: nothing to pick instead.
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("says a closed form is closed, with Pick another form", async () => {
    const { apply } = mount([formNode("a", picked("3"))], { "3": "closed" });
    expect(
      await screen.findByText(
        "This form is closed. Visitors see its closed message."
      )
    ).toBeTruthy();
    const pick = await screen.findByRole("combobox", {
      name: "Pick another form",
    });
    fireEvent.click(pick);
    fireEvent.click(screen.getByRole("option", { name: "Request a quote" }));
    expect(apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { props: { form: { provider: "forms", ref: "1" } } },
    });
  });

  it("says a deleted form was deleted, over the room its box is given", async () => {
    mount([formNode("a", picked("9"))], { "9": "missing" });
    expect(await screen.findByText("This form was deleted.")).toBeTruthy();
    expect(
      await screen.findByRole("combobox", { name: "Pick another form" })
    ).toBeTruthy();
    const box = document.querySelector<HTMLElement>(
      "[data-nx-form-unavailable]"
    );
    expect(box?.style.getPropertyValue("min-block-size")).toBe("6rem");
  });

  it("says nothing over a form whose state could not be read", async () => {
    const { pickedFormState } = mount([formNode("a", picked("5"))], {
      "5": new Error("down"),
    });
    await waitFor(() => expect(pickedFormState).toHaveBeenCalled());
    await Promise.resolve();
    expect(document.querySelector("[data-form-notice]")).toBeNull();
  });
});

describe("a picked form changed elsewhere", () => {
  it("is read again when the author comes back to the editor", async () => {
    const states: Record<string, PickedFormState | Error> = { "2": "draft" };
    const { pickedFormState } = mount(
      [formNode("a", picked("2")), formNode("b", picked("2"))],
      states
    );
    expect(
      await screen.findAllByText(
        "Draft form: visitors can't send it until it's published"
      )
    ).toHaveLength(2);
    // Published in the form's own tab, then back to the builder.
    states["2"] = "published";
    comeBack();
    await waitFor(() =>
      expect(document.querySelector("[data-form-notice]")).toBeNull()
    );
    // One read per form each time, however many blocks pick it.
    expect(pickedFormState).toHaveBeenCalledTimes(2);
  });

  it("is not read again while the editor's tab is hidden", async () => {
    const { pickedFormState } = mount([formNode("a", picked("2"))], {
      "2": "draft",
    });
    await screen.findByText(
      "Draft form: visitors can't send it until it's published"
    );
    tabBecomes("hidden");
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(pickedFormState).toHaveBeenCalledTimes(1);
    tabBecomes("visible");
  });

  it("is tried again after a failed read, once the author comes back", async () => {
    const states: Record<string, PickedFormState | Error> = {
      "3": new Error("down"),
    };
    const { pickedFormState } = mount([formNode("a", picked("3"))], states);
    await waitFor(() => expect(pickedFormState).toHaveBeenCalledTimes(1));
    states["3"] = "closed";
    comeBack();
    expect(
      await screen.findByText(
        "This form is closed. Visitors see its closed message."
      )
    ).toBeTruthy();
  });
});

describe("a deleted form's plate", () => {
  it("selects the Form when the plate is clicked, but not through its picker", async () => {
    const { editor } = mount([formNode("a", picked("9"))], { "9": "missing" });
    fireEvent.click(await screen.findByText("This form was deleted."));
    expect(editor.select).toHaveBeenCalledWith("a");
    vi.mocked(editor.select).mockClear();
    fireEvent.click(
      await screen.findByRole("combobox", { name: "Pick another form" })
    );
    expect(editor.select).not.toHaveBeenCalled();
  });
});

describe("a simple form on the canvas", () => {
  it("says its answers have nowhere to go while Send to is empty", async () => {
    mount(
      [
        formNode("a", { action: "" }),
        formNode("b", { action: "https://example.com/hook" }),
      ],
      {}
    );
    expect(
      await screen.findByText(
        "Answers have nowhere to go yet: add an address, or install the Forms plugin to save them"
      )
    ).toBeTruthy();
    expect(document.querySelectorAll("[data-form-notice]")).toHaveLength(1);
  });
});
