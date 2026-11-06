/**
 * The site's one fonts folder, claimed: against a fake media library and a
 * fake claim row, so each interleave of two server processes is fixed rather
 * than raced. The integration suite runs the claim on every database.
 */
import { describe, expect, it, vi } from "vitest";

import {
  claimedFontsFolder,
  FONTS_FOLDER,
  type FontsFolderClaims,
  type FontsFolderSource,
  type RootFolder,
} from "./folder";

/** A media library's root folders, recording what it makes and deletes. */
function libraryOf(...folders: RootFolder[]) {
  const held = [...folders];
  let made = 0;
  const source = {
    list: vi.fn<FontsFolderSource["list"]>(async () => [...held]),
    create: vi.fn<FontsFolderSource["create"]>(async () => {
      made += 1;
      const folder = { id: `made-${String(made)}`, name: FONTS_FOLDER };
      held.push(folder);
      return { id: folder.id };
    }),
    remove: vi.fn<FontsFolderSource["remove"]>(async id => {
      held.splice(
        held.findIndex(folder => folder.id === id),
        1
      );
    }),
  };
  return { source, held };
}

/** The claim row as one table holds it: one insert of it wins. */
function claimRow(value: string | null = null) {
  const row = { value };
  const claims: FontsFolderClaims = {
    read: vi.fn(async () => row.value),
    claim: vi.fn(async (id: string) => {
      if (row.value !== null) return false;
      row.value = id;
      return true;
    }),
    replace: vi.fn(async (was: string, id: string) => {
      if (row.value !== was) return false;
      row.value = id;
      return true;
    }),
  };
  return { claims, row };
}

describe("the site's fonts folder", () => {
  it("makes the folder and claims it on a site with none", async () => {
    const { source, held } = libraryOf();
    const { claims, row } = claimRow();
    const id = await claimedFontsFolder(source, claims);
    expect(id).toBe("made-1");
    expect(row.value).toBe("made-1");
    expect(held.map(folder => folder.id)).toEqual(["made-1"]);
  });

  it("uses the claimed folder while it exists, making nothing", async () => {
    const { source } = libraryOf(
      { id: "f-old", name: FONTS_FOLDER },
      { id: "f-claimed", name: FONTS_FOLDER }
    );
    const { claims } = claimRow("f-claimed");
    expect(await claimedFontsFolder(source, claims)).toBe("f-claimed");
    expect(source.create).not.toHaveBeenCalled();
    expect(claims.claim).not.toHaveBeenCalled();
  });

  it("claims the oldest Fonts folder a site already has, then the lowest id", async () => {
    const { source } = libraryOf(
      { id: "f-b", name: FONTS_FOLDER, createdAt: "2026-02-01T00:00:00Z" },
      { id: "f-c", name: FONTS_FOLDER, createdAt: "2026-01-01T00:00:00Z" },
      { id: "f-a", name: FONTS_FOLDER, createdAt: "2026-01-01T00:00:00Z" },
      { id: "f-other", name: "Images", createdAt: "2025-01-01T00:00:00Z" }
    );
    const { claims, row } = claimRow();
    expect(await claimedFontsFolder(source, claims)).toBe("f-a");
    expect(row.value).toBe("f-a");
    expect(source.create).not.toHaveBeenCalled();
  });

  it("uses the winner's folder after losing the claim, and deletes the one it made", async () => {
    const { source, held } = libraryOf();
    const { claims, row } = claimRow();
    // Another process makes its folder and claims it between this call's
    // reads and its own claim.
    source.create.mockImplementationOnce(async () => {
      held.push({ id: "theirs", name: FONTS_FOLDER });
      row.value = "theirs";
      held.push({ id: "mine", name: FONTS_FOLDER });
      return { id: "mine" };
    });
    expect(await claimedFontsFolder(source, claims)).toBe("theirs");
    expect(source.remove).toHaveBeenCalledWith("mine");
    expect(held.map(folder => folder.id)).toEqual(["theirs"]);
  });

  it("keeps the folder it made when the winner claimed that very folder", async () => {
    const { source, held } = libraryOf();
    const { claims, row } = claimRow();
    // The other process saw this call's new folder as the oldest and
    // claimed it first.
    source.create.mockImplementationOnce(async () => {
      held.push({ id: "mine", name: FONTS_FOLDER });
      row.value = "mine";
      return { id: "mine" };
    });
    expect(await claimedFontsFolder(source, claims)).toBe("mine");
    expect(source.remove).not.toHaveBeenCalled();
  });

  it("makes and claims a new folder when the claimed one was deleted", async () => {
    const { source } = libraryOf({ id: "f-other", name: "Images" });
    const { claims, row } = claimRow("f-deleted");
    expect(await claimedFontsFolder(source, claims)).toBe("made-1");
    expect(claims.replace).toHaveBeenCalledWith("f-deleted", "made-1");
    expect(row.value).toBe("made-1");
  });

  it("uses the folder of a repair that moved the claim first, and deletes its own", async () => {
    const { source, held } = libraryOf();
    const { claims, row } = claimRow("f-deleted");
    source.create.mockImplementationOnce(async () => {
      held.push({ id: "repaired", name: FONTS_FOLDER });
      row.value = "repaired";
      held.push({ id: "mine", name: FONTS_FOLDER });
      return { id: "mine" };
    });
    expect(await claimedFontsFolder(source, claims)).toBe("repaired");
    expect(source.remove).toHaveBeenCalledWith("mine");
    expect(row.value).toBe("repaired");
  });

  it("still answers the winner's folder when its own cannot be deleted", async () => {
    const { source, held } = libraryOf();
    const { claims, row } = claimRow();
    source.create.mockImplementationOnce(async () => {
      held.push({ id: "theirs", name: FONTS_FOLDER });
      row.value = "theirs";
      return { id: "mine" };
    });
    source.remove.mockRejectedValueOnce(new Error("the folder is not empty"));
    expect(await claimedFontsFolder(source, claims)).toBe("theirs");
  });

  it("gives up after a few tries when the claim never settles", async () => {
    const { source } = libraryOf();
    const claims: FontsFolderClaims = {
      // A claim naming a folder never seen, and every claim lost.
      read: vi.fn(async () => "elsewhere"),
      claim: vi.fn(async () => false),
      replace: vi.fn(async () => false),
    };
    await expect(claimedFontsFolder(source, claims)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
    // Each try made a folder, and deleted it again on losing.
    expect(source.create).toHaveBeenCalledTimes(3);
    expect(source.remove).toHaveBeenCalledTimes(3);
  });
});
