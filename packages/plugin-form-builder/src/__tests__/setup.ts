/**
 * Globals a DOM test environment needs but jsdom does not provide.
 *
 * The admin bundle this plugin's components import opens a dev-mode SSE
 * connection at module scope, guarded on `window` existing. Under jsdom that
 * guard passes and jsdom has no `EventSource`, so importing any admin-backed
 * component throws before a single test runs. Stubbed rather than worked
 * around in each file because the failure happens at import time, where a
 * `beforeAll` is already too late.
 *
 * Only defined when absent, so a real implementation always wins.
 */
if (!("EventSource" in globalThis)) {
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
