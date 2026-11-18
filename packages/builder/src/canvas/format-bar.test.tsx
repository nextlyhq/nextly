// @vitest-environment jsdom
/**
 * The floating format bar, as a Text is offered it: "B", "I" and "Link",
 * "Turn into" once a host can turn a block into another, and no headings,
 * lists or quotes. Its buttons press the editor's own verbs, its address
 * field refuses an address that would run script, and a paste that lost
 * formatting leaves the notice under the words.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CANVAS_ROOT_CLASS } from "./canvas";
import { FORMAT_BAR_WORDS, FormatBar } from "./format-bar";
import type { TurnIntoOffer } from "../turn-into-verb";

import {
  createFormatBarStore,
  formatBar,
  formatBarShown,
  TEXT_FORMAT_ACTIONS,
  type FormatTarget,
  type FormatTurnInto,
} from "./format-bar-state";

afterEach(() => {
  const open = formatBar.get().target;
  if (open !== null) formatBar.close(open.element);
  cleanup();
  document.body.innerHTML = "";
});

/** The canvas the bar is drawn over, holding the words it serves. */
let canvas: HTMLElement;

/** Draws the bar in the canvas, as the overlay does. */
function drawBar() {
  const layer = document.createElement("div");
  canvas.append(layer);
  return render(<FormatBar />, { container: layer });
}

function serve(extra: Partial<FormatTarget> = {}) {
  canvas = document.createElement("div");
  canvas.className = CANVAS_ROOT_CLASS;
  document.body.append(canvas);
  const element = document.createElement("p");
  canvas.append(element);
  const session = {
    format: vi.fn(),
    link: vi.fn(),
    focus: vi.fn(),
    selection: vi.fn(() => undefined),
  };
  const finish = vi.fn();
  const target: FormatTarget = {
    element,
    session,
    actions: TEXT_FORMAT_ACTIONS,
    finish,
    ...extra,
  };
  act(() => {
    formatBar.open(target);
    formatBar.selected({
      collapsed: false,
      bold: false,
      italic: true,
      link: null,
    });
  });
  return { session, finish, element };
}

describe("the bar a Text is offered", () => {
  it("shows B, I and Link, and no headings, lists or quotes", () => {
    serve();
    drawBar();
    const bar = screen.getByRole("toolbar", { name: FORMAT_BAR_WORDS.bar });
    const names = [...bar.querySelectorAll("button")].map(button => [
      button.textContent,
      button.getAttribute("aria-label") ?? button.textContent,
    ]);
    expect(names).toEqual([
      ["B", "Bold"],
      ["I", "Italic"],
      ["Link", "Link"],
    ]);
    for (const absent of [
      /H2/,
      /H3/,
      /bullet/i,
      /number/i,
      /quote/i,
      /Turn into/,
    ]) {
      expect(screen.queryByRole("button", { name: absent })).toBeNull();
    }
  });

  it("draws Turn into once the host can turn the block into another", () => {
    serve({ turnInto: turning().turnInto });
    drawBar();
    const button = screen.getByRole("button", { name: "Turn into" });
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("presses the editor's own bold and italic, and says which are on", () => {
    const { session } = serve();
    drawBar();
    const bold = screen.getByRole("button", { name: "Bold" });
    const italic = screen.getByRole("button", { name: "Italic" });
    expect(bold.getAttribute("aria-pressed")).toBe("false");
    expect(italic.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(bold);
    fireEvent.click(italic);
    expect(session.format.mock.calls).toEqual([["bold"], ["italic"]]);
  });

  it("never takes the focus out of the words on a press", () => {
    serve();
    drawBar();
    const press = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    screen.getByRole("button", { name: "Bold" }).dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
  });

  it("is not drawn while no words are selected", () => {
    serve();
    act(() => {
      formatBar.selected({
        collapsed: true,
        bold: false,
        italic: false,
        link: null,
      });
    });
    drawBar();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
});

describe("a link", () => {
  it("refuses an address that would run script, and applies a real one", () => {
    const { session } = serve();
    drawBar();
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    const address = screen.getByRole("textbox", {
      name: FORMAT_BAR_WORDS.address,
    });
    expect(document.activeElement).toBe(address);

    fireEvent.change(address, { target: { value: "javascript:alert(1)" } });
    fireEvent.submit(address);
    expect(session.link).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      FORMAT_BAR_WORDS.badAddress
    );

    fireEvent.change(address, { target: { value: " https://example.com/a " } });
    fireEvent.click(
      screen.getByRole("checkbox", { name: FORMAT_BAR_WORDS.newTab })
    );
    fireEvent.submit(address);
    expect(session.link).toHaveBeenCalledWith("https://example.com/a", {
      newTab: true,
    });
    expect(session.focus).toHaveBeenCalled();
    expect(formatBar.get().linking).toBe(false);
  });

  it("takes an address on this site, which the browser's own URL check would refuse", () => {
    const { session } = serve();
    drawBar();
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    const address = screen.getByRole("textbox", {
      name: FORMAT_BAR_WORDS.address,
    }) as HTMLInputElement;
    for (const relative of ["/about", "#team"]) {
      fireEvent.change(address, { target: { value: relative } });
      expect(address.checkValidity()).toBe(true);
    }
    fireEvent.submit(address);
    expect(session.link).toHaveBeenCalledWith("#team", { newTab: false });
  });

  it("takes a link off with Remove link", () => {
    const { session } = serve();
    act(() => {
      formatBar.selected({
        collapsed: false,
        bold: false,
        italic: false,
        link: { url: "/about", newTab: false },
      });
      formatBar.setLinking(true);
    });
    drawBar();
    expect(
      (
        screen.getByRole("textbox", {
          name: FORMAT_BAR_WORDS.address,
        }) as HTMLInputElement
      ).value
    ).toBe("/about");
    fireEvent.click(
      screen.getByRole("button", { name: FORMAT_BAR_WORDS.removeLink })
    );
    expect(session.link).toHaveBeenCalledWith(null);
  });

  it("closes on Escape and gives the words their caret back", () => {
    const { session } = serve();
    drawBar();
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(formatBar.get().linking).toBe(false);
    expect(session.focus).toHaveBeenCalled();
    expect(formatBar.holdsFocus()).toBe(false);
  });
});

describe("the keyboard", () => {
  it("reaches the bar on request, moves along it, and returns on Escape", () => {
    const { session } = serve();
    drawBar();
    act(() => formatBar.requestFocus());
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Bold" })
    );
    expect(formatBar.holdsFocus()).toBe(true);
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Italic" })
    );
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Link" })
    );
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Bold" })
    );
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(session.focus).toHaveBeenCalled();
    expect(formatBar.holdsFocus()).toBe(false);
  });

  it("is drawn and focused on request even over a caret with nothing selected", () => {
    serve();
    act(() => {
      formatBar.selected({
        collapsed: true,
        bold: false,
        italic: false,
        link: null,
      });
    });
    drawBar();
    expect(screen.queryByRole("toolbar")).toBeNull();
    act(() => formatBar.requestFocus());
    // Drawn, not merely focused: a hidden bar takes no focus in a browser.
    const bar = screen.getByRole("toolbar", { name: FORMAT_BAR_WORDS.bar });
    expect(bar.hidden).toBe(false);
    const bold = screen.getByRole("button", { name: "Bold" });
    expect(document.activeElement).toBe(bold);
    expect(formatBar.holdsFocus()).toBe(true);
  });

  it("finishes the edit at once when the focus leaves the bar for another field", () => {
    // Before anything else can take the shared editor: an inspector field
    // attaching on focus would otherwise supersede the words first.
    const { finish } = serve();
    const field = document.createElement("input");
    document.body.append(field);
    drawBar();
    act(() => formatBar.requestFocus());
    act(() => field.focus());
    expect(finish).toHaveBeenCalled();
    expect(formatBar.holdsFocus()).toBe(false);
  });

  it("finishes the edit when the focus leaves the bar for anywhere but the words", async () => {
    const { finish } = serve();
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    drawBar();
    act(() => formatBar.requestFocus());
    await act(async () => {
      elsewhere.focus();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(finish).toHaveBeenCalled();
    expect(formatBar.holdsFocus()).toBe(false);
  });
});


/** A host's "Turn into": Rich text open, Heading open and saying what goes. */
function turning(
  heading: Partial<TurnIntoOffer> = {}
): { turnInto: FormatTurnInto; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn();
  const offers: TurnIntoOffer[] = [
    {
      id: "turn-into-rich-text",
      to: "core/rich-text",
      name: "Rich text",
      label: "Turn into Rich text",
      enabled: true,
    },
    {
      id: "turn-into-heading",
      to: "core/heading",
      name: "Heading",
      label: "Turn into Heading",
      enabled: true,
      note: "Bold and links are removed",
      ...heading,
    },
  ];
  return { turnInto: { choices: () => offers, run }, run };
}

describe("Turn into, in the bar", () => {
  it("opens the choices, each saying what it removes", () => {
    serve({ turnInto: turning().turnInto });
    drawBar();
    fireEvent.click(screen.getByRole("button", { name: "Turn into" }));
    const menu = screen.getByRole("menu", { name: "Turn into" });
    const items = [...menu.querySelectorAll("[role='menuitem']")].map(
      item => item.textContent
    );
    expect(items).toEqual(["Rich text", "HeadingBold and links are removed"]);
  });

  it("turns the block into the choice pressed, and closes the choices", () => {
    const { turnInto, run } = turning();
    serve({ turnInto });
    drawBar();
    fireEvent.click(screen.getByRole("button", { name: "Turn into" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Heading/ }));
    expect(run).toHaveBeenCalledWith("core/heading");
    expect(formatBar.get().turning).toBe(false);
  });

  it("dims a choice that is not open, and says why", () => {
    serve({
      turnInto: turning({
        enabled: false,
        reason: "Intro is locked, so nothing about it may change.",
      }).turnInto,
    });
    drawBar();
    fireEvent.click(screen.getByRole("button", { name: "Turn into" }));
    const heading = screen.getByRole("menuitem", { name: /^Heading/ });
    expect((heading as HTMLButtonElement).disabled).toBe(true);
    expect(heading.textContent).toContain("Intro is locked");
  });

  it("goes back to the words on Escape", () => {
    const { session } = serve({ turnInto: turning().turnInto });
    drawBar();
    fireEvent.click(screen.getByRole("button", { name: "Turn into" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(session.focus).toHaveBeenCalled();
  });
});

describe("the notice a paste leaves", () => {
  it("says what a Text keeps, in one line, and goes when dismissed", () => {
    serve();
    drawBar();
    act(() => formatBar.setDropped(true));
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain(
      "Text keeps words, bold, italic and links. Use Rich text for headings and lists"
    );
    expect(
      screen.queryByRole("button", { name: "Turn into Rich text" })
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: FORMAT_BAR_WORDS.dismiss })
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers Turn into Rich text once the host can, and turns the block", () => {
    const { turnInto, run } = turning();
    serve({ turnInto });
    drawBar();
    act(() => formatBar.setDropped(true));
    fireEvent.click(
      screen.getByRole("button", { name: "Turn into Rich text" })
    );
    expect(run).toHaveBeenCalledWith("core/rich-text");
  });
});

describe("the store", () => {
  it("serves one passage at a time, and a stale close keeps the newer", () => {
    const store = createFormatBarStore();
    const first = document.createElement("p");
    const second = document.createElement("p");
    const target = (element: HTMLElement): FormatTarget => ({
      element,
      session: {
        format: vi.fn(),
        link: vi.fn(),
        focus: vi.fn(),
        selection: vi.fn(),
      },
      actions: TEXT_FORMAT_ACTIONS,
      finish: vi.fn(),
    });
    store.open(target(first));
    store.open(target(second));
    store.close(first);
    expect(store.get().target?.element).toBe(second);
    store.close(second);
    expect(store.get().target).toBeNull();
  });

  it("is shown for selected words or an open address field only", () => {
    const store = createFormatBarStore();
    expect(formatBarShown(store.get())).toBe(false);
    store.open({
      element: document.createElement("p"),
      session: {
        format: vi.fn(),
        link: vi.fn(),
        focus: vi.fn(),
        selection: vi.fn(),
      },
      actions: TEXT_FORMAT_ACTIONS,
      finish: vi.fn(),
    });
    expect(formatBarShown(store.get())).toBe(false);
    store.selected({
      collapsed: false,
      bold: false,
      italic: false,
      link: null,
    });
    expect(formatBarShown(store.get())).toBe(true);
    store.selected({ collapsed: true, bold: false, italic: false, link: null });
    store.setLinking(true);
    expect(formatBarShown(store.get())).toBe(true);
  });
});
