/**
 * What an unbind keeps, decided from what a visitor sees: never a value they
 * can't see, and an image kept as they saw it, by its library id or its
 * address.
 */
import {
  COLLECTION_LIST_TYPE,
  createBindingRun,
  DOCUMENT_FORMAT_VERSION,
  LIST_ENTRY_SLOT,
  type BlockDocument,
  type BlockNode,
  type PropSchema,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  foreignMediaOf,
  listOf,
  unboundAsWritten,
  unbindPlan,
  type VisitorView,
} from "./unbind-kept";

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

  it("keeps a private image's fallback address in the address prop, the media prop emptied", () => {
    const address = "https://cdn.example.com/members-only.jpg";
    const plan = unbindPlan(
      "mediaId",
      "memberPhoto",
      view({
        filled: { mediaId: address },
        unreadable: { fallback: { value: address } },
      }),
      IMAGE
    );
    // Written into the media prop, the address would read as a library id
    // and the image visitors saw would vanish.
    expect(plan).toMatchObject({
      kept: { set: { src: address }, empty: ["mediaId"] },
      answer: { kept: "fallback", value: address, into: "src" },
    });
  });
});

describe("the list a list child is drawn in", () => {
  const list = (id: string, collection: string, entries: BlockNode[]) =>
    ({
      id,
      type: COLLECTION_LIST_TYPE,
      version: 1,
      props: { query: { collection } },
      slots: { [LIST_ENTRY_SLOT]: entries },
    }) as unknown as BlockNode;
  const title: BlockNode = {
    id: "title",
    type: "core/heading",
    version: 1,
    props: { text: "" },
  };
  const page: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [list("authors", "authors", [list("posts", "posts", [title])])],
  };

  it("is the nearest list, not an outer one whose entries hold it too", () => {
    expect(listOf(page, "title")?.id).toBe("posts");
    expect(listOf(page, "posts")?.id).toBe("authors");
    expect(listOf(page, "authors")).toBeUndefined();
  });
});

describe("an image bound into a collection other than the media library", () => {
  const node: BlockNode = {
    id: "img",
    type: "core/image",
    version: 1,
    props: {},
    bindings: { mediaId: { $bind: "photo" } },
  };
  const runWith = (relationTo: string, mediaCollection?: string) =>
    createBindingRun({
      sources: { entry: { photo: "p1" } },
      entryRef: { collection: "articles" },
      schema: {
        fieldsOf: () => [{ name: "photo", type: "upload", relationTo }],
      },
      ...(mediaCollection === undefined ? {} : { mediaCollection }),
      props: { get: () => ({ props: IMAGE }) },
    });

  it("asks for the value: the site's pages may draw images from it", () => {
    expect(
      foreignMediaOf(node, "mediaId", runWith("photos"), { phase: "page" })
    ).toEqual({ needs: expect.stringContaining("“photos”") });
  });

  it("reads the media library's own images as a visitor does", () => {
    expect(
      foreignMediaOf(node, "mediaId", runWith("media"), { phase: "page" })
    ).toBeUndefined();
    // A run that draws from the collection asks nothing either.
    expect(
      foreignMediaOf(node, "mediaId", runWith("photos", "photos"), {
        phase: "page",
      })
    ).toBeUndefined();
  });
});

describe("the unbind's answer, as the page was written", () => {
  const answer = {
    kept: "visitor" as const,
    value: "Spring sale",
    reason: "The prop keeps what visitors saw.",
  };
  const written = (node: Partial<BlockNode>): BlockDocument => ({
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [{ id: "h", type: "core/heading", version: 1, props: {}, ...node }],
  });

  it("is given when the page holds the value it names, the binding gone", () => {
    expect(
      unboundAsWritten(
        answer,
        written({ props: { text: "Spring sale" } }),
        "h",
        "text"
      )
    ).toEqual({ unbound: answer });
  });

  it("is left out where a hook stored something else", () => {
    // A hook rewrote the text, kept the binding, or dropped the block.
    for (const document of [
      written({ props: { text: "SPRING SALE" } }),
      written({
        props: { text: "Spring sale" },
        bindings: { text: { $bind: "title" } },
      }),
      written({ id: "other" }),
      undefined,
    ]) {
      expect(unboundAsWritten(answer, document, "h", "text")).toEqual({});
    }
  });
});
