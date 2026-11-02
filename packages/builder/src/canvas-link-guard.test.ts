// @vitest-environment jsdom
/**
 * The canvas draws the page as published, links and forms included, and a
 * click there selects a block. It must never ALSO follow the link or submit the
 * form: that navigates the editor away from unsaved work.
 */
import { afterEach, describe, expect, it } from "vitest";

import { guardCanvasNavigation } from "./canvas-link-guard";

/** A canvas root holding a linked button, a plain block and a form. */
function canvasIn(doc: Document): {
  root: HTMLElement;
  label: HTMLElement;
  plain: HTMLElement;
  form: HTMLFormElement;
} {
  const root = doc.createElement("div");
  root.innerHTML = `
    <div data-nx-node="cta"><a href="/signup"><span>Sign up</span></a></div>
    <p data-nx-node="text">Plain text</p>
    <form data-nx-node="form" action="/subscribe"><button>Go</button></form>`;
  doc.body.append(root);
  return {
    root,
    label: root.querySelector("span") as HTMLElement,
    plain: root.querySelector("p") as HTMLElement,
    form: root.querySelector("form") as HTMLFormElement,
  };
}

/** Dispatches a cancelable event and answers whether its default was stopped. */
function stopped(target: EventTarget, event: Event): boolean {
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function click(type = "click", button = 0): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, button });
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
});

function guarded(doc: Document = document) {
  const canvas = canvasIn(doc);
  cleanups.push(guardCanvasNavigation(canvas.root));
  return canvas;
}

describe("guardCanvasNavigation", () => {
  it("stops a click inside a link from following it", () => {
    const { label } = guarded();
    expect(stopped(label, click())).toBe(true);
  });

  it("stops a middle click, which would open the link in a new tab", () => {
    const { label } = guarded();
    expect(stopped(label, click("auxclick", 1))).toBe(true);
  });

  it("stops a form inside the canvas from submitting", () => {
    const { form } = guarded();
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    expect(stopped(form, submit)).toBe(true);
  });

  it("leaves the click itself to arrive, so selection still runs", () => {
    const { root, label } = guarded();
    let arrived = false;
    root.addEventListener("click", () => {
      arrived = true;
    });
    label.dispatchEvent(click());
    expect(arrived).toBe(true);
  });

  it("leaves a click on a block that is not a link alone", () => {
    const { plain } = guarded();
    expect(stopped(plain, click())).toBe(false);
  });

  it("leaves a link outside the canvas alone", () => {
    guarded();
    const outside = document.createElement("a");
    outside.href = "/elsewhere";
    document.body.append(outside);
    expect(stopped(outside, click())).toBe(false);
  });

  it("guards a canvas whose document is another frame's", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const doc = frame.contentDocument as Document;
    const view = doc.defaultView as Window & typeof globalThis;
    const { label } = guarded(doc);
    // The frame's own event constructor, as a click inside a frame would be.
    const inFrame = new view.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    expect(stopped(label, inFrame)).toBe(true);
  });

  it("stops guarding once released", () => {
    const { root, label } = canvasIn(document);
    guardCanvasNavigation(root)();
    expect(stopped(label, click())).toBe(false);
  });
});
