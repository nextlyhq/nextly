import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { expect } from "vitest";

// jest-dom's matchers, on the `expect` these tests import. Not through
// `@testing-library/jest-dom/vitest`, which extends the `expect` of whichever
// vitest resolves from jest-dom's own folder: a second copy here, and on Vitest 5
// extending it breaks `rejects.toThrow` in the file that imports it
// (`packages/admin/src/__tests__/setup.ts` has the measurement).
expect.extend(jestDomMatchers);

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
