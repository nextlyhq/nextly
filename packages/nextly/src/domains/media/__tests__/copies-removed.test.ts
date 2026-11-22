/**
 * Resized copies leave with their original: every copy an image can have is
 * removed with it from a storage that keeps copies, none from one that
 * cannot, and none while another item still refers to the original.
 */
import { describe, expect, it } from "vitest";

import { Bucket } from "../../../storage/__tests__/stand-in-bucket";
import { MediaStorage } from "../../../storage/storage";
import { copyPathsOf } from "../copies/copy-rules";
import {
  filesToRemoveOf,
  removeStoredFiles,
  storageReadingOf,
} from "../remove-stored-files";
import { copiesToRemove, type MediaFilesRecord } from "../stored-files";

const PHOTO: MediaFilesRecord = {
  filename: "2026/11/0b6f-photo.jpg",
  mimeType: "image/jpeg",
  url: "/uploads/2026/11/0b6f-photo.jpg",
  thumbnailUrl: null,
};

/** A storage recording what it is asked to remove. */
function remover(keepsCopies?: boolean) {
  const removed: string[] = [];
  return {
    removed,
    storage: {
      delete: async (path: string) => {
        removed.push(path);
      },
      ...(keepsCopies === undefined ? {} : { keepsCopies: () => keepsCopies }),
    },
  };
}

describe("copiesToRemove", () => {
  it("is every copy the original can have, from a storage that keeps copies", () => {
    expect(copiesToRemove(PHOTO, true, new Set())).toEqual(copyPathsOf(PHOTO));
  });

  it("is none from a storage that cannot keep copies", () => {
    expect(copiesToRemove(PHOTO, false, new Set())).toEqual([]);
  });

  it("is none while another item refers to the original", () => {
    expect(copiesToRemove(PHOTO, true, new Set([PHOTO.filename]))).toEqual([]);
  });
});

describe("removeStoredFiles", () => {
  it("removes the original's copies with it where the storage keeps them", async () => {
    const { removed, storage } = remover(true);
    expect(await removeStoredFiles(storage, PHOTO, "photo")).toBe(true);
    expect(removed).toContain(PHOTO.filename);
    for (const copy of copyPathsOf(PHOTO)) expect(removed).toContain(copy);
  });

  it("asks a storage that keeps no copies to remove only the original", async () => {
    for (const keeps of [false, undefined]) {
      const { removed, storage } = remover(keeps);
      await removeStoredFiles(storage, PHOTO, "photo");
      expect(removed).toEqual([PHOTO.filename]);
    }
  });

  it("keeps the copies of an original another item refers to", async () => {
    const { removed, storage } = remover(true);
    await removeStoredFiles(storage, PHOTO, "photo", new Set([PHOTO.filename]));
    expect(removed).toEqual([]);
  });
});

describe("filesToRemoveOf", () => {
  it("asks about the copies too, where the storage keeps them", () => {
    const keeping = storageReadingOf({ keepsCopies: () => true });
    expect(filesToRemoveOf(PHOTO, keeping)).toEqual([
      PHOTO.filename,
      ...copyPathsOf(PHOTO),
    ]);
    const keepingNone = storageReadingOf({ keepsCopies: () => false });
    expect(filesToRemoveOf(PHOTO, keepingNone)).toEqual([PHOTO.filename]);
  });
});

describe("a copy another item names as its own file", () => {
  it("is kept when its original is removed", async () => {
    const { removed, storage } = remover(true);
    const named = `${PHOTO.filename}.w640.webp`;
    await removeStoredFiles(storage, PHOTO, "photo", new Set([named]));
    expect(removed).toContain(PHOTO.filename);
    expect(removed).not.toContain(named);
    expect(removed).toContain(`${PHOTO.filename}.w320.webp`);
  });
});

describe("MediaStorage.keepsCopies", () => {
  it("answers for the storage the collection's files go to", () => {
    const storage = new MediaStorage();
    expect(storage.keepsCopies("media")).toBe(true);
    for (const [scheme, keeps] of [
      ["s3", true],
      ["vercel-blob", true],
      ["uploadthing", false],
    ] as const) {
      storage.registerPlugin({
        name: `keeps-${scheme}`,
        type: scheme,
        collections: { media: true },
        adapter: new Bucket(scheme),
      });
      expect(storage.keepsCopies("media")).toBe(keeps);
    }
  });
});
