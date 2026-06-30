import { describe, it, expect, beforeEach } from "vitest";
import { getEventBus, resetEventBus } from "../event-bus";
import {
  emitDocumentEvent,
  emitAuthEvent,
  emitMediaEvent,
  safeEmit,
} from "../domain-events";

describe("domain-events", () => {
  beforeEach(() => resetEventBus());

  it("document.* and media.* are reserved (no undeclared warning)", () => {
    const warnings: string[] = [];
    getEventBus().setLogger({ warn: (m: string) => warnings.push(m) });
    getEventBus().emit("document.published", {});
    getEventBus().emit("media.uploaded", {});
    expect(warnings).toEqual([]);
  });

  it("emitDocumentEvent delivers with the document. prefix + collection", async () => {
    const got: unknown[] = [];
    getEventBus().on("document.statusChanged", e => {
      got.push(e.payload);
    });
    emitDocumentEvent("statusChanged", "posts", {
      id: "1",
      status: "published",
      previousStatus: "draft",
    });
    await getEventBus().settle();
    expect(got).toEqual([
      {
        collection: "posts",
        id: "1",
        status: "published",
        previousStatus: "draft",
      },
    ]);
  });

  it("emitAuthEvent / emitMediaEvent deliver under their prefixes", async () => {
    const got: string[] = [];
    getEventBus().on("auth.loggedIn", () => got.push("auth"));
    getEventBus().on("media.uploaded", () => got.push("media"));
    emitAuthEvent("loggedIn", { userId: "u" });
    emitMediaEvent("uploaded", { mediaId: "m" });
    await getEventBus().settle();
    expect(got.sort()).toEqual(["auth", "media"]);
  });

  it("safeEmit never throws even if the bus throws", () => {
    // smoke: emitting an unknown name shouldn't throw out of safeEmit
    expect(() => safeEmit("custom.thing", { a: 1 })).not.toThrow();
  });
});
