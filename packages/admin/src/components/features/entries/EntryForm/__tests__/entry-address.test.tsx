// Whether an entry's slug is already a public address decides two things at once: whether the
// auto-slug generator keeps rewriting it, and whether the editor warns before an edit lands. Both
// break quietly — a URL moves and nothing says so — so the predicate is exercised directly.

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { effectiveEntryStatus, useHasPublicAddress } from "../entry-address";
import type { EntryData } from "../useEntryForm";

const entry = (over: Partial<EntryData> = {}): EntryData => ({
  id: "e1",
  ...over,
});

describe("effectiveEntryStatus", () => {
  it("reads the active locale's status, not the main row's", () => {
    // The row is a draft, but the German translation is live. Reading `status` off the row calls a
    // published translation unpublished and lets its URL be rewritten.
    const result = effectiveEntryStatus(
      entry({
        status: "draft",
        _translations: { de: { status: "published" } },
      }),
      "de"
    );

    expect(result).toBe("published");
  });

  it("does not inherit the default language's published state", () => {
    // The mirror case. The row is published, this translation has no companion row at all, so it is
    // not live in this language and must not be treated as though it were.
    const result = effectiveEntryStatus(
      entry({
        status: "published",
        _translations: { en: { status: "published" } },
      }),
      "de"
    );

    expect(result).toBeUndefined();
  });

  it("falls back to the row status when there is no translation map", () => {
    // A non-localized collection has one lifecycle and it lives on the row.
    expect(
      effectiveEntryStatus(entry({ status: "published" }), undefined)
    ).toBe("published");
  });
});

describe("useHasPublicAddress", () => {
  const render = (args: Parameters<typeof useHasPublicAddress>[0]) =>
    renderHook(props => useHasPublicAddress(props), { initialProps: args });

  it("is false while creating", () => {
    const { result } = render({
      mode: "create",
      hasStatus: true,
      entry: null,
      locale: undefined,
    });

    expect(result.current).toBe(false);
  });

  it("treats every persisted entry as live when the collection has no draft lifecycle", () => {
    // Without Draft/Published there is no unpublished state to be in: saving publishes. Asking
    // whether such an entry is "published" can only answer no, which would leave every entry in
    // these collections auto-rewriting a live URL.
    const { result } = render({
      mode: "edit",
      hasStatus: false,
      entry: entry(),
      locale: undefined,
    });

    expect(result.current).toBe(true);
  });

  it("is false for a draft in a collection that has the lifecycle", () => {
    const { result } = render({
      mode: "edit",
      hasStatus: true,
      entry: entry({ status: "draft" }),
      locale: undefined,
    });

    expect(result.current).toBe(false);
  });

  it("follows the active locale rather than the row", () => {
    const { result } = render({
      mode: "edit",
      hasStatus: true,
      entry: entry({
        status: "draft",
        _translations: { de: { status: "published" } },
      }),
      locale: "de",
    });

    expect(result.current).toBe(true);
  });

  it("stays true after the entry is unpublished", () => {
    // Unpublishing returns the row to draft, but the links and search results that accumulated
    // while it was live do not go away. Letting the slug track again here means republishing
    // silently lands at a different address.
    const { result, rerender } = render({
      mode: "edit",
      hasStatus: true,
      entry: entry({ status: "published" }),
      locale: undefined,
    });
    expect(result.current).toBe(true);

    rerender({
      mode: "edit",
      hasStatus: true,
      entry: entry({ status: "draft" }),
      locale: undefined,
    });

    expect(result.current).toBe(true);
  });

  it("does not carry that history to a different entry", () => {
    // The editor stays mounted across documents, so an unkeyed latch would freeze the slug of the
    // next draft the author opened purely because the previous one was live.
    const { result, rerender } = render({
      mode: "edit",
      hasStatus: true,
      entry: entry({ id: "published-one", status: "published" }),
      locale: undefined,
    });
    expect(result.current).toBe(true);

    rerender({
      mode: "edit",
      hasStatus: true,
      entry: entry({ id: "draft-two", status: "draft" }),
      locale: undefined,
    });

    expect(result.current).toBe(false);
  });

  it("does not carry that history to another language of the same entry", () => {
    // Publishing is per locale, so switching to an untranslated language is a different address
    // with its own lifecycle.
    const published = {
      status: "draft",
      _translations: {
        en: { status: "published" },
        de: { status: "draft" },
      },
    };
    const { result, rerender } = render({
      mode: "edit",
      hasStatus: true,
      entry: entry(published),
      locale: "en",
    });
    expect(result.current).toBe(true);

    rerender({
      mode: "edit",
      hasStatus: true,
      entry: entry(published),
      locale: "de",
    });

    expect(result.current).toBe(false);
  });
});
