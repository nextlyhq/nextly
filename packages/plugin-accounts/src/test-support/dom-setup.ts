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
