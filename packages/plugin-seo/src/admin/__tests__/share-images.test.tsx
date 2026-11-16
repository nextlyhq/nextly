// @vitest-environment jsdom
/**
 * Making a share image: the copy is set as the page's image only while the
 * tab still shows the document, language and picture it was made for; one
 * that comes back after any of them changed is let go.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The route's answer, held until the test lets it go. */
const route = vi.hoisted(() => ({
  answer: (_value: unknown) => {},
}));
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  writePluginRoute: () =>
    new Promise(resolve => {
      route.answer = resolve;
    }),
  useMediaItem: () => ({ data: undefined }),
}));

import { useShareImages } from "../share-images";

const values = { ogImage: "picture-1" };

function setup(documentKey: string) {
  const set = vi.fn((_next: unknown) => true);
  const hook = renderHook(
    ({ documentKey: key, ogImage }) =>
      useShareImages({}, { ogImage }, undefined, key, set),
    { initialProps: { documentKey, ogImage: values.ogImage } }
  );
  return { set, hook };
}

beforeEach(() => {
  route.answer = () => {};
});

describe("making a share image", () => {
  it("sets the copy on the page it was made for", async () => {
    const { set, hook } = setup("collection:posts:p1:en");
    const made = hook.result.current.make?.();
    await act(async () => {
      route.answer({ item: { id: "copy-1" } });
      await made;
    });
    expect(set).toHaveBeenCalledWith("copy-1");
    await expect(made).resolves.toBe("copy-1");
  });

  it("lets a copy go once another language is shown", async () => {
    const { set, hook } = setup("single:home:s1:en");
    const made = hook.result.current.make?.();
    hook.rerender({ documentKey: "single:home:s1:fr", ogImage: "picture-1" });
    await act(async () => {
      route.answer({ item: { id: "copy-1" } });
      await made;
    });
    expect(set).not.toHaveBeenCalled();
    await expect(made).resolves.toBeUndefined();
  });

  it("lets a copy go once another picture is chosen", async () => {
    const { set, hook } = setup("collection:posts:p1:en");
    const made = hook.result.current.make?.();
    hook.rerender({
      documentKey: "collection:posts:p1:en",
      ogImage: "picture-2",
    });
    await act(async () => {
      route.answer({ item: { id: "copy-1" } });
      await made;
    });
    expect(set).not.toHaveBeenCalled();
  });
});
