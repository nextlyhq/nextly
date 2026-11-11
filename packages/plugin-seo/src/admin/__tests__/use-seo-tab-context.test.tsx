// @vitest-environment jsdom
/**
 * What the SEO tab asks its route: the document as typed, the tab's own
 * values included, since the page's structured data reads them (a chosen
 * share image is the image an article is described with), and again once a
 * change to any of them settles.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => [] as { body: unknown }[]);
/** Whether the route answers at once, or never, as a slow read stays open. */
const route = vi.hoisted(() => ({
  answers: true,
  value: undefined as unknown,
}));
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  writePluginRoute: (request: { body: unknown }) => {
    sent.push({ body: request.body });
    return route.answers
      ? Promise.resolve(route.value)
      : new Promise<undefined>(() => {});
  },
}));

import { useSeoTabContext } from "../use-seo-tab-context";

const TARGET = {
  kind: "collection" as const,
  slug: "posts",
  locale: null,
  id: null,
};

beforeEach(() => {
  vi.useFakeTimers();
  sent.length = 0;
  route.answers = true;
  route.value = undefined;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("what the SEO tab asks its route", () => {
  it("sends the tab's own values, and asks again when one of them changes", async () => {
    const { rerender } = renderHook(
      ({ document }) => useSeoTabContext(TARGET, document),
      {
        initialProps: {
          document: { title: "Post", seo: { ogImage: "m1" } } as Record<
            string,
            unknown
          >,
        },
      }
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toMatchObject({
      document: { seo: { ogImage: "m1" } },
    });

    rerender({ document: { title: "Post", seo: { ogImage: "m2" } } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(sent).toHaveLength(2);
    expect(sent[1]?.body).toMatchObject({
      document: { seo: { ogImage: "m2" } },
    });
  });

  it("waits for typing to settle even while a slow read is cut short", async () => {
    route.answers = false;
    const doc = (title: string) => ({ title, seo: {} });
    const { rerender } = renderHook(
      ({ document }) => useSeoTabContext(TARGET, document),
      { initialProps: { document: doc("P") as Record<string, unknown> } }
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(sent).toHaveLength(1);

    // Each key cuts the read in flight short; none is sent until the typing
    // has paused.
    for (const title of ["Po", "Pos", "Post"]) {
      rerender({ document: doc(title) });
      await act(() => vi.advanceTimersByTimeAsync(100));
    }
    expect(sent).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(sent).toHaveLength(2);
    expect(sent[1]?.body).toMatchObject({ document: { title: "Post" } });
  });

  it("forgets another document's levels when it moves to a new one", async () => {
    route.value = { levels: {}, typeLabel: "Post" };
    const document = { title: "P" };
    const { result, rerender } = renderHook(
      ({ target }) => useSeoTabContext(target, document),
      { initialProps: { target: TARGET } }
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.context).toEqual(route.value);

    route.answers = false;
    rerender({ target: { ...TARGET, locale: "es" } });
    expect(result.current.context).toBeUndefined();
    expect(result.current.status).toBe("loading");
  });
});
