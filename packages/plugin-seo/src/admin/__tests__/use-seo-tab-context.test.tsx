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
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  writePluginRoute: (request: { body: unknown }) => {
    sent.push({ body: request.body });
    return Promise.resolve(undefined);
  },
}));

import { useSeoTabContext } from "../use-seo-tab-context";

const TARGET = { kind: "collection" as const, slug: "posts", locale: null };

beforeEach(() => {
  vi.useFakeTimers();
  sent.length = 0;
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
});
