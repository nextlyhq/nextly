/**
 * A removal's saved-title reads on a real site's shape: no read starts once
 * the dry run's deadline has passed, even one already waiting on what the
 * collection is.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const readSavedAsCaller = vi.fn(async () => ({ id: "p1", title: "Saved" }));

vi.mock("../entry-reads", () => ({
  entryOf: (row: { id: string; title?: string }) => ({
    id: row.id,
    title: row.title ?? "Untitled",
  }),
  findAsCaller: vi.fn(),
  readSavedAsCaller: (...args: unknown[]) => readSavedAsCaller(...(args as [])),
}));

const { savedTitlesAsCaller } = await import("./site-counter");

/** A site whose collection resolves after `ms`. */
const slowSite = (ms: number) => ({
  resolveCollection: () =>
    new Promise<unknown>(resolve =>
      setTimeout(() => resolve({ admin: { useAsTitle: "title" } }), ms)
    ),
});

const page = {
  kind: "collection" as const,
  slug: "pages",
  id: "p1",
  path: ["content"],
};

beforeEach(() => {
  readSavedAsCaller.mockClear();
});

describe("reading a removal's documents by their saved titles", () => {
  it("starts no read once the deadline has passed", async () => {
    const titles = await savedTitlesAsCaller(
      slowSite(40),
      { caller: null },
      [page],
      new Date(Date.now() + 10)
    );
    expect(titles.size).toBe(0);
    expect(readSavedAsCaller).not.toHaveBeenCalled();
  });

  it("CONTROL: reads it while there is time", async () => {
    const titles = await savedTitlesAsCaller(
      slowSite(0),
      { caller: null },
      [page],
      new Date(Date.now() + 5_000)
    );
    expect(readSavedAsCaller).toHaveBeenCalledTimes(1);
    expect([...titles.values()]).toEqual(["Saved"]);
  });
});
