// @vitest-environment jsdom

// The schema version a plugin can read, and the moves it is told of: the
// version each response announces, noted by `noteSchemaVersion`, whoever
// caused the move.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { noteSchemaVersion, onSchemaChange, schemaVersion } from "./fetcher";

/** A response announcing schema version `version`. */
function announcing(version: string): Response {
  return new Response(null, {
    headers: { "X-Nextly-Schema-Version": version },
  });
}

beforeEach(() => {
  delete window.__nextlySchemaVersion;
  delete window.__nextlySchemaApplying;
});
afterEach(() => {
  delete window.__nextlySchemaVersion;
  delete window.__nextlySchemaApplying;
});

describe("schemaVersion", () => {
  it("is unknown until a response carries a version, then the last one", () => {
    expect(schemaVersion()).toBeUndefined();
    noteSchemaVersion(announcing("4"));
    expect(schemaVersion()).toBe(4);
    noteSchemaVersion(announcing("5"));
    expect(schemaVersion()).toBe(5);
  });

  it("keeps the version a response without one leaves", () => {
    noteSchemaVersion(announcing("4"));
    noteSchemaVersion(new Response(null));
    expect(schemaVersion()).toBe(4);
  });
});

describe("onSchemaChange", () => {
  it("tells of a move, and nothing for the first version or the same one", () => {
    const told = vi.fn();
    const stop = onSchemaChange(told);
    noteSchemaVersion(announcing("4"));
    noteSchemaVersion(announcing("4"));
    expect(told).not.toHaveBeenCalled();
    noteSchemaVersion(announcing("5"));
    expect(told).toHaveBeenCalledExactlyOnceWith(5);
    stop();
  });

  it("tells of this tab's own apply, which the window event leaves out", () => {
    const told = vi.fn();
    const event = vi.fn();
    window.addEventListener("nextly:schema-updated", event);
    const stop = onSchemaChange(told);
    noteSchemaVersion(announcing("4"));
    window.__nextlySchemaApplying = true;
    noteSchemaVersion(announcing("5"));
    expect(told).toHaveBeenCalledExactlyOnceWith(5);
    // The event is unchanged: this tab's own apply is not announced as an
    // outside change.
    expect(event).not.toHaveBeenCalled();
    window.removeEventListener("nextly:schema-updated", event);
    stop();
  });

  it("a listener that throws fails neither the note nor the others", async () => {
    const reported = new Promise<unknown>(resolve => {
      const original = globalThis.queueMicrotask;
      vi.stubGlobal("queueMicrotask", (task: () => void) => {
        original(() => {
          try {
            task();
          } catch (error) {
            resolve(error);
          }
        });
      });
    });
    const told = vi.fn();
    const stopThrowing = onSchemaChange(() => {
      throw new Error("a listener broke");
    });
    const stop = onSchemaChange(told);
    noteSchemaVersion(announcing("4"));
    expect(() => noteSchemaVersion(announcing("5"))).not.toThrow();
    expect(schemaVersion()).toBe(5);
    expect(told).toHaveBeenCalledExactlyOnceWith(5);
    // The error is still reported, on its own.
    expect(await reported).toEqual(new Error("a listener broke"));
    vi.unstubAllGlobals();
    stopThrowing();
    stop();
  });

  it("tells nothing once stopped", () => {
    const told = vi.fn();
    const stop = onSchemaChange(told);
    noteSchemaVersion(announcing("4"));
    stop();
    noteSchemaVersion(announcing("5"));
    expect(told).not.toHaveBeenCalled();
  });
});
