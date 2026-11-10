/**
 * What kind of DOM node a value is, answered the same way in every realm.
 *
 * `x instanceof HTMLElement` compares `x` against the constructor of the realm
 * doing the asking. A node built by another document's window — the canvas
 * mounted into a same-origin iframe, an event fired inside it — carries that
 * window's constructors, so the check answers `false` for a perfectly ordinary
 * element. Code reading it that way returns early and does nothing, silently,
 * on exactly the canvas it was written for.
 *
 * So every question here is asked of the node's own STRUCTURE: its `nodeType`,
 * its namespace and its local name, which are the same values whichever window
 * built it. They are also what the DOM itself means by the interfaces: every
 * element in the HTML namespace implements `HTMLElement`, and a `<textarea>`
 * there is an `HTMLTextAreaElement`.
 *
 * One module, because a realm-safe spelling written correctly once is copied
 * wrongly afterwards. `dom-kind-ban.test.ts` refuses an `instanceof` against a
 * DOM constructor anywhere else in this package's shipped source.
 *
 * @module dom-kind
 */

/** `Node.ELEMENT_NODE`, spelled as the number so no realm's `Node` is read. */
const ELEMENT_NODE = 1;

/** The namespace every element of an HTML document is created in. */
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/**
 * Whether a value is an element, from any realm.
 *
 * Takes `unknown` because the callers hold an `EventTarget` — an event's
 * target can be the window or the document as well as an element — and asking
 * for `nodeType` on anything else answers no rather than throwing.
 */
export function isElement(value: unknown): value is Element {
  return (
    typeof value === "object" &&
    value !== null &&
    "nodeType" in value &&
    value.nodeType === ELEMENT_NODE
  );
}

/**
 * Whether a value is an HTML element, from any realm.
 *
 * By namespace, because that is what decides the interface: an element in the
 * HTML namespace is an `HTMLElement`, and an `<svg>` or MathML element is not,
 * however it is spelled. `focus`, `offsetWidth` and `isContentEditable` are on
 * this interface, so it is the question to ask before reaching for them.
 */
export function isHTMLElement(value: unknown): value is HTMLElement {
  return isElement(value) && value.namespaceURI === HTML_NAMESPACE;
}

/** Whether a value is a `<textarea>`, from any realm. */
export function isTextArea(value: unknown): value is HTMLTextAreaElement {
  return isHTMLElement(value) && value.localName === "textarea";
}

/** Whether a value is an `<input>`, from any realm. */
export function isInput(value: unknown): value is HTMLInputElement {
  return isHTMLElement(value) && value.localName === "input";
}

/**
 * Whether a value is a form field whose value lives outside the DOM: an
 * `<input>`, a `<textarea>` or a `<select>`, from any realm.
 */
export function isFormField(
  value: unknown
): value is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return (
    isHTMLElement(value) &&
    (value.localName === "input" ||
      value.localName === "textarea" ||
      value.localName === "select")
  );
}

/** Whether a value is an `<iframe>`, from any realm. */
export function isIFrame(value: unknown): value is HTMLIFrameElement {
  return isHTMLElement(value) && value.localName === "iframe";
}

/**
 * The element that has focus, looking inside a focused same-origin iframe.
 *
 * `document.activeElement` read from the host reports the IFRAME while focus
 * is on something inside it, so a question about what the author is typing in
 * — a field, a contenteditable passage — has to be asked of the frame's own
 * document. This follows focus down through each focused frame whose document
 * the host can read; a cross-origin frame has no readable document and is
 * where the walk stops.
 *
 * A frame whose document has nothing focused — its `activeElement` is its body
 * or nothing — answers with the iframe element itself. That is what holds focus
 * from the host's side, and it is the element focus can be put back on: a
 * frame's body takes no focus of its own.
 *
 * Not the answer to "is focus inside this container" for a container in the
 * host. The innermost element belongs to the frame's document, which no host
 * element contains, while the iframe the host reports is contained by the
 * region that renders it — so those checks read `activeElement` directly.
 */
export function deepActiveElement(doc: Document): Element | null {
  let active = doc.activeElement;
  while (isIFrame(active)) {
    const inner = active.contentDocument;
    if (inner === null) break;
    const focused = inner.activeElement;
    if (
      focused === null ||
      focused === inner.body ||
      focused === inner.documentElement
    ) {
      break;
    }
    active = focused;
  }
  return active;
}
