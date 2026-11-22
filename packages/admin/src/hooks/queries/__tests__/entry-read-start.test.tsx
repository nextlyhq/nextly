/**
 * When the edit page's entry reads start: with the navigation's list, before
 * the collection's schema, where the list says whether the collection keeps
 * drafts; with the schema once it has arrived, which then decides, as it does
 * for a save; and never before the site's languages and the person's
 * permissions, the other parts of the read's key, are known.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  listed: undefined as { items: Record<string, unknown>[] } | undefined,
  brandingPending: false,
  answer: "allowed" as string,
}));

vi.mock("@admin/hooks/queries/useCollections", () => ({
  NAV_COLLECTIONS_PARAMS: {},
  useCollections: () => ({ data: state.listed }),
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBrandingStatus: () => ({ isPending: state.brandingPending }),
}));
vi.mock("@admin/hooks/useUpdateAnswer", () => ({
  useUpdateAnswer: () => state.answer,
}));

import { listedKeepsDrafts, useEntryReadStart } from "../entry-read-start";

const drafts = { enabled: true, drafts: { enabled: true } };

describe("useEntryReadStart", () => {
  beforeEach(() => {
    state.listed = {
      items: [
        { name: "pages", status: true, versions: drafts },
        { name: "notes", status: false, versions: null },
      ],
    };
    state.brandingPending = false;
    state.answer = "allowed";
  });

  it("starts before the schema, in the held-draft view the list names", () => {
    expect(
      renderHook(() => useEntryReadStart("pages", undefined)).result.current
    ).toEqual({ ready: true, draft: true });
    expect(
      renderHook(() => useEntryReadStart("notes", undefined)).result.current
    ).toEqual({ ready: true, draft: false });
  });

  it("waits for the schema where the list does not name the collection", () => {
    expect(
      renderHook(() => useEntryReadStart("elsewhere", undefined)).result.current
        .ready
    ).toBe(false);
    state.listed = undefined;
    expect(
      renderHook(() => useEntryReadStart("pages", undefined)).result.current
        .ready
    ).toBe(false);
  });

  it("takes the schema's word once it has arrived", () => {
    // Drafts asked for, held back by a rule only the schema reports.
    expect(
      renderHook(() =>
        useEntryReadStart("pages", {
          draftsEnabled: false,
          draftsDisabledReason: "password-field",
        })
      ).result.current
    ).toEqual({ ready: true, draft: false });
    expect(
      renderHook(() =>
        useEntryReadStart("notes", {
          draftsEnabled: false,
          draftsDisabledReason: "localized-component",
        })
      ).result.current
    ).toEqual({ ready: true, draft: true });
  });

  it("waits for the languages and the permissions", () => {
    state.brandingPending = true;
    expect(
      renderHook(() => useEntryReadStart("pages", undefined)).result.current
        .ready
    ).toBe(false);
    state.brandingPending = false;
    state.answer = "unknown";
    expect(
      renderHook(() => useEntryReadStart("pages", { draftsEnabled: true }))
        .result.current.ready
    ).toBe(false);
  });
});

describe("listedKeepsDrafts", () => {
  it.each([
    [{ status: true, versions: drafts }, true],
    [{ status: false, versions: drafts }, false],
    [{ status: true, versions: { drafts: { enabled: false } } }, false],
    [{ status: true, versions: null }, false],
    [{ status: true }, undefined],
    [{ versions: drafts }, undefined],
  ])("reads %j as %s", (listed, keeps) => {
    expect(listedKeepsDrafts(listed as never)).toBe(keeps);
  });
});
