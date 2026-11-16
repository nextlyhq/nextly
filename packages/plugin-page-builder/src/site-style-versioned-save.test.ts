/**
 * One section saved onto the newest stored copy: merged before each write,
 * sent with the version of the copy it was merged onto, and read and merged
 * again after a stale refusal, three tries in all.
 */
import { describe, expect, it, vi } from "vitest";

import {
  saveSectionMerged,
  type VersionedSiteStyle,
} from "./site-style-versioned-save";

const card = { id: "c1", slug: "card", orderIndex: 0, styles: {} };
const hero = { id: "c2", slug: "hero", orderIndex: 1, styles: {} };
const promo = { id: "c3", slug: "promo", orderIndex: 2, styles: {} };

/** A stale refusal as a server-side caller would see its public data. */
class Stale extends Error {
  constructor(readonly data: unknown) {
    super("stale");
  }
}

const staleOf = (error: unknown) =>
  error instanceof Stale ? error.data : undefined;

const at = (classes: unknown, rev: string): VersionedSiteStyle => ({
  doc: { classes },
  rev,
});

describe("saving a section merged onto the newest copy", () => {
  it("writes the merge with the version of the copy it was merged onto", async () => {
    const write = vi.fn(async (data: Record<string, unknown>) =>
      at(data.classes, "6")
    );
    const read = vi.fn(async () => at([card], "5"));
    const saved = await saveSectionMerged({
      section: "classes",
      base: [card],
      mine: [card, promo],
      prefer: "mine",
      latest: at([card, hero], "5"),
      read,
      write,
      staleOf,
    });
    expect(write.mock.calls.map(call => call[0])).toEqual([
      { classes: [card, hero, promo], _rev: "5" },
    ]);
    expect(read).not.toHaveBeenCalled();
    expect(saved).toEqual({
      stored: [card, hero, promo],
      replaced: [card, hero],
      latest: at([card, hero, promo], "6"),
      attempts: 1,
    });
  });

  it("reads again after a stale refusal, merges again and stores both changes", async () => {
    const write = vi
      .fn<(data: Record<string, unknown>) => Promise<VersionedSiteStyle>>()
      .mockRejectedValueOnce(new Stale({ currentVersion: "6" }))
      .mockImplementation(async data => at(data.classes, "7"));
    const read = vi.fn(async () => at([card, hero], "6"));
    const saved = await saveSectionMerged({
      section: "classes",
      base: [card],
      mine: [card, promo],
      prefer: "mine",
      latest: at([card], "5"),
      read,
      write,
      staleOf,
    });
    expect(write.mock.calls.map(call => call[0])).toEqual([
      { classes: [card, promo], _rev: "5" },
      { classes: [card, hero, promo], _rev: "6" },
    ]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(saved.stored).toEqual([card, hero, promo]);
    expect(saved.replaced).toEqual([card, hero]);
    expect(saved.attempts).toBe(2);
    expect(saved.conflicts).toBeUndefined();
  });

  it("describes a true conflict with who made the save it met", async () => {
    const mine = { ...card, label: "Mine" };
    const theirs = { ...card, label: "Theirs" };
    const write = vi
      .fn<(data: Record<string, unknown>) => Promise<VersionedSiteStyle>>()
      .mockRejectedValueOnce(
        new Stale({
          currentVersion: "6",
          changedBy: { kind: "person", name: "Sam" },
        })
      )
      .mockImplementation(async data => at(data.classes, "7"));
    const saved = await saveSectionMerged({
      section: "classes",
      base: [card],
      mine: [mine],
      prefer: "mine",
      latest: at([card], "5"),
      read: async () => at([theirs], "6"),
      write,
      staleOf,
    });
    expect(saved.stored).toEqual([mine]);
    expect(saved.conflicts).toEqual({
      entries: [
        {
          key: "c1",
          setting: false,
          kind: "changed",
          kept: "mine",
          base: card,
          mine,
          theirs,
        },
      ],
      refusal: {
        changedBy: { name: "Sam", kind: "person" },
        oneSaveBetween: true,
      },
    });
  });

  it("does not say one save came between when the version moved by more", async () => {
    const write = vi
      .fn<(data: Record<string, unknown>) => Promise<VersionedSiteStyle>>()
      .mockRejectedValueOnce(
        new Stale({ currentVersion: "8", changedBy: { name: "Sam" } })
      )
      .mockImplementation(async data => at(data.classes, "9"));
    const saved = await saveSectionMerged({
      section: "classes",
      base: [card],
      mine: [{ ...card, label: "Mine" }],
      prefer: "mine",
      latest: at([card], "5"),
      read: async () => at([{ ...card, label: "Theirs" }], "8"),
      write,
      staleOf,
    });
    expect(saved.conflicts?.refusal?.oneSaveBetween).toBe(false);
  });

  it("names no one when a later save landed before the retry's read", async () => {
    // Refused by Sam's save at 6, but the retry read 7: the conflict may be
    // the later save's, whose author is not Sam.
    const write = vi
      .fn<(data: Record<string, unknown>) => Promise<VersionedSiteStyle>>()
      .mockRejectedValueOnce(
        new Stale({
          currentVersion: "6",
          changedBy: { kind: "person", name: "Sam" },
        })
      )
      .mockImplementation(async data => at(data.classes, "8"));
    const saved = await saveSectionMerged({
      section: "classes",
      base: [card],
      mine: [{ ...card, label: "Mine" }],
      prefer: "mine",
      latest: at([card], "5"),
      read: async () => at([{ ...card, label: "Theirs" }], "7"),
      write,
      staleOf,
    });
    expect(write.mock.calls.at(-1)?.[0]).toMatchObject({ _rev: "7" });
    expect(saved.conflicts?.refusal).toEqual({ oneSaveBetween: false });
  });

  it("names no one for a conflict the first copy already held, whatever save refused it", async () => {
    // The newest copy already differs from the base on card when the save
    // starts; the one save that refuses it changes hero, not card. Sam did
    // not make the conflict, so no one is named.
    const mine = { ...card, label: "Mine" };
    const theirs = { ...card, label: "Theirs" };
    const renamedHero = { ...hero, label: "Banner" };
    const write = vi
      .fn<(data: Record<string, unknown>) => Promise<VersionedSiteStyle>>()
      .mockRejectedValueOnce(
        new Stale({
          currentVersion: "6",
          changedBy: { kind: "person", name: "Sam" },
        })
      )
      .mockImplementation(async data => at(data.classes, "7"));
    const saved = await saveSectionMerged({
      section: "classes",
      base: [card, hero],
      mine: [mine, hero],
      prefer: "mine",
      latest: at([theirs, hero], "5"),
      read: async () => at([theirs, renamedHero], "6"),
      write,
      staleOf,
    });
    expect(saved.stored).toEqual([mine, renamedHero]);
    expect(saved.conflicts).toEqual({
      entries: [expect.objectContaining({ key: "c1", kind: "changed" })],
      refusal: { oneSaveBetween: false },
    });
  });

  it("rejects with the last stale refusal after three refused writes", async () => {
    let version = 5;
    const refusals: Stale[] = [];
    const write = vi.fn(async () => {
      version += 1;
      const refusal = new Stale({ currentVersion: String(version) });
      refusals.push(refusal);
      throw refusal;
    });
    const read = vi.fn(async () => at([card], String(version)));
    const answered = await saveSectionMerged({
      section: "classes",
      base: [card],
      mine: [card, promo],
      prefer: "mine",
      latest: at([card], "5"),
      read,
      write,
      staleOf,
    }).catch((error: unknown) => error);
    expect(refusals).toHaveLength(3);
    expect(answered).toBe(refusals[2]);
    expect(write).toHaveBeenCalledTimes(3);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("rejects with any other failure at once, reading nothing again", async () => {
    const failure = new Error("Validation failed.");
    const write = vi.fn(async () => {
      throw failure;
    });
    const read = vi.fn(async () => at([card], "6"));
    await expect(
      saveSectionMerged({
        section: "classes",
        base: [card],
        mine: [promo],
        prefer: "mine",
        latest: at([card], "5"),
        read,
        write,
        staleOf,
      })
    ).rejects.toBe(failure);
    expect(write).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
  });
});
