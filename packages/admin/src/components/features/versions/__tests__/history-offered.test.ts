/**
 * Whether a document offers its history: the one rule the document bar's
 * History and a Single's side panel both ask, so the two cannot disagree.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useHistoryOffered, type HistoryOfferFacts } from "../history-offered";

const can = vi.hoisted(() => ({ readHistory: true, asked: [] as unknown[] }));
vi.mock("@admin/hooks/useCanRequest", () => ({
  useCanRequest: (slug: string, request: string) => {
    can.asked.push({ slug, request });
    return request === "readHistory" ? can.readHistory : true;
  },
}));

const SAVED: HistoryOfferFacts = {
  mode: "edit",
  documentId: "d1",
  fields: [],
  enabled: true,
};

const offered = (facts: Partial<HistoryOfferFacts> = {}) =>
  renderHook(() => useHistoryOffered("site-settings", { ...SAVED, ...facts }))
    .result.current;

beforeEach(() => {
  can.readHistory = true;
  can.asked = [];
});

describe("useHistoryOffered", () => {
  it("offers a saved document's history to someone who may read it", () => {
    expect(offered()).toBe(true);
    expect(can.asked).toContainEqual({
      slug: "site-settings",
      request: "readHistory",
    });
  });

  it("offers it where the schema does not say whether it keeps versions", () => {
    expect(offered({ enabled: undefined })).toBe(true);
  });

  it.each<[string, Partial<HistoryOfferFacts>]>([
    ["a document being created", { mode: "create" }],
    ["a document not saved yet", { documentId: undefined }],
    ["a document whose fields are not known yet", { fields: undefined }],
    ["a type that keeps no versions", { enabled: false }],
  ])("does not offer it for %s", (_, facts) => {
    expect(offered(facts)).toBe(false);
  });

  it("does not offer it to someone who may not read the history", () => {
    can.readHistory = false;
    expect(offered()).toBe(false);
  });
});
