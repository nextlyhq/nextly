/**
 * The expiry after a change to grants reads which collections and Singles
 * there are, and that read has no hand-off of its own: a failed read is tried
 * once more, and one that fails again is logged as an error, never thrown,
 * since the change it follows has committed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const content = vi.hoisted(() => vi.fn());
const flush = vi.hoisted(() => vi.fn(async () => undefined));
const logged = vi.hoisted(() => vi.fn());

vi.mock("../../di/registrations/language-change-content-cache", () => ({
  languageChangeContentCache: () => ({
    content,
    revalidator: () => ({ flush }),
  }),
}));
vi.mock("../../observability/logger", () => ({
  getNextlyLogger: () => ({ error: logged }),
}));

const { expireContentAfterGrantsChange } = await import(
  "../flush-content-change"
);

const SCOPES = { collections: [{ slug: "posts" }], singles: [] };

beforeEach(() => {
  content.mockReset();
  flush.mockClear();
  logged.mockClear();
});

describe("the content expiry after a change to grants", () => {
  it("expires every scope's tags", async () => {
    content.mockResolvedValue(SCOPES);
    await expireContentAfterGrantsChange();
    expect(flush).toHaveBeenCalledWith([{ tags: ["nextly:posts"] }]);
    expect(logged).not.toHaveBeenCalled();
  });

  it("reads the scopes again when the first read fails", async () => {
    content
      .mockRejectedValueOnce(new Error("database busy"))
      .mockResolvedValue(SCOPES);
    await expireContentAfterGrantsChange();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(logged).not.toHaveBeenCalled();
  });

  it("logs an error, and does not throw, when both reads fail", async () => {
    content.mockRejectedValue(new Error("database down"));
    await expect(expireContentAfterGrantsChange()).resolves.toBeUndefined();
    expect(flush).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "grants-change-content-expiry-failed" })
    );
  });
});
