/**
 * What an unbind keeps, decided from what a visitor sees: never a value they
 * can't see, and an image kept as they saw it, by its library id or its
 * address.
 */
import type { PropSchema } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { unbindPlan, type VisitorView } from "./unbind-kept";

const view = (over: Partial<VisitorView>): VisitorView => ({
  filled: { text: "Spring sale: 30% off" },
  bound: { kind: "value" },
  ...over,
});

const IMAGE: Readonly<Record<string, PropSchema>> = {
  mediaId: { type: "media", addressProp: "src" },
  src: { type: "url" },
};

describe("unbindPlan", () => {
  it("keeps what a visitor sees", () => {
    expect(unbindPlan("text", "title", view({}), undefined)).toEqual({
      kept: { set: { text: "Spring sale: 30% off" } },
      answer: expect.objectContaining({
        kept: "visitor",
        value: "Spring sale: 30% off",
      }),
    });
  });

  it("keeps the fallback where a visitor sees it", () => {
    const plan = unbindPlan(
      "text",
      "title",
      view({ filled: { text: "Untitled" }, bound: { kind: "fallback" } }),
      undefined
    );
    expect(plan).toMatchObject({
      kept: { set: { text: "Untitled" } },
      answer: { kept: "fallback", value: "Untitled" },
    });
  });

  it("never copies in a field visitors can't read: the fallback, or the block's own value", () => {
    const withFallback = unbindPlan(
      "text",
      "internalNote",
      view({
        filled: { text: "Ask us at the front desk" },
        unreadable: { fallback: { value: "Ask us at the front desk" } },
      }),
      undefined
    );
    expect(withFallback).toMatchObject({
      kept: { set: { text: "Ask us at the front desk" } },
      answer: { kept: "fallback" },
    });
    expect(
      "answer" in withFallback ? withFallback.answer.reason : ""
    ).toContain("internalNote");

    const without = unbindPlan(
      "text",
      "internalNote",
      view({ unreadable: {} }),
      undefined
    );
    // Its own value stays: nothing is set, so the private value is not written.
    expect(without).toMatchObject({
      kept: { set: {} },
      answer: { kept: "own" },
    });
  });

  it("keeps the block's own value where the binding fills nothing", () => {
    expect(
      unbindPlan("text", "title", view({ bound: undefined }), undefined)
    ).toMatchObject({ kept: { set: {} }, answer: { kept: "own" } });
  });

  it("keeps an image seen by its library id in the media prop", () => {
    const plan = unbindPlan(
      "mediaId",
      "cover",
      view({
        filled: { mediaId: "m1" },
        bound: { kind: "image", holds: "media", from: "value" },
      }),
      IMAGE
    );
    expect(plan).toMatchObject({
      kept: { set: { mediaId: "m1" } },
      answer: { kept: "visitor", value: "m1" },
    });
  });

  it("keeps an image seen by its address in the declared address prop, the media prop emptied", () => {
    const address = "https://cdn.example.com/cover.jpg";
    const plan = unbindPlan(
      "mediaId",
      "coverUrl",
      view({
        filled: { mediaId: address },
        bound: { kind: "image", holds: "address", from: "value" },
      }),
      IMAGE
    );
    expect(plan).toMatchObject({
      kept: { set: { src: address }, empty: ["mediaId"] },
      answer: { kept: "visitor", value: address, into: "src" },
    });
  });

  it("refuses to drop an address-held image where the block declares no address prop", () => {
    const plan = unbindPlan(
      "mediaId",
      "coverUrl",
      view({
        filled: { mediaId: "https://cdn.example.com/cover.jpg" },
        bound: { kind: "image", holds: "address", from: "value" },
      }),
      { mediaId: { type: "media" } }
    );
    expect(plan).toEqual({
      refusal: expect.stringContaining("no address prop"),
    });
  });
});
