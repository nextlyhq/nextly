/**
 * What jsdom lacks that the admin bundle needs as it loads: it opens a
 * development reload stream at module scope whenever `window` exists, and
 * jsdom has no `EventSource`, so importing any of the admin's components
 * would throw before a test ran. Only filled in where a DOM exists and the
 * global is absent, so the node suites and a real implementation are left
 * as they are.
 */
if ("document" in globalThis && !("EventSource" in globalThis)) {
  class EventSourceStub {
    addEventListener(): void {}
    removeEventListener(): void {}
    close(): void {}
  }
  Object.defineProperty(globalThis, "EventSource", {
    value: EventSourceStub,
    writable: true,
    configurable: true,
  });
}

export {};

/**
 * What the admin's select needs that jsdom lacks: it captures the pointer
 * as it opens and scrolls the chosen option into view. Filled in only where
 * a DOM exists and the method is absent.
 */
if ("document" in globalThis && typeof Element !== "undefined") {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  if (!("hasPointerCapture" in proto)) proto.hasPointerCapture = () => false;
  if (!("releasePointerCapture" in proto))
    proto.releasePointerCapture = () => {};
  if (!("scrollIntoView" in proto)) proto.scrollIntoView = () => {};
}

/**
 * A file's text, which every browser reads with `Blob.text()` and jsdom
 * lacks: read through jsdom's own `FileReader`, so a screen reading a chosen
 * file is tested as it runs.
 */
if ("document" in globalThis && typeof Blob !== "undefined") {
  const blob = Blob.prototype as unknown as Record<string, unknown>;
  if (!("text" in blob)) {
    blob.text = function text(this: Blob): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this);
      });
    };
  }
}
