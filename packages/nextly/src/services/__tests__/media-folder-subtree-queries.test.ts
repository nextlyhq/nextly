/**
 * Deleting a folder with a large subtree asks about the items of every folder
 * under it in a bounded number of statements, not one per folder: whether
 * any of them waits inside its Undo window, and which items go with the
 * folder's contents. Counted on the connection itself, by the statements that
 * read the media table by folder.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTestDb,
  testLogger,
  type TestDb,
} from "../../__tests__/fixtures/db";
import { pendingDeleteKey } from "../../domains/media/pending-delete";
import { MediaFolderService } from "../media-folder";

let db: TestDb;
let folders: MediaFolderService;

/** How many folders sit under the root: more than one statement may bind. */
const SUBFOLDERS = 1_200;

beforeEach(async () => {
  db = await createTestDb();
  await db.db.insert(db.schema.users).values({
    id: "user-1",
    email: "user@example.com",
    name: "User",
    passwordHash: "hash",
  });
  folders = new MediaFolderService(db.adapter, testLogger);
  const now = new Date();
  await db.db.insert(db.schema.mediaFolders).values({
    id: "root",
    name: "Root",
    parentId: null,
    createdBy: "user-1",
    createdAt: now,
    updatedAt: now,
  });
  const rows = Array.from({ length: SUBFOLDERS }, (_, i) => ({
    id: `sub-${String(i).padStart(4, "0")}`,
    name: `Sub ${i}`,
    parentId: "root",
    createdBy: "user-1",
    createdAt: now,
    updatedAt: now,
  }));
  for (let start = 0; start < rows.length; start += 100) {
    await db.db
      .insert(db.schema.mediaFolders)
      .values(rows.slice(start, start + 100));
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
});

/** An item in `folderId`. */
async function itemIn(id: string, folderId: string): Promise<void> {
  await db.db.insert(db.schema.media).values({
    id,
    filename: `2026/11/${id}.pdf`,
    originalFilename: `${id}.pdf`,
    mimeType: "application/pdf",
    size: 10,
    url: `/uploads/2026/11/${id}.pdf`,
    uploadedBy: "user-1",
    uploadedAt: new Date(),
    updatedAt: new Date(),
    folderId,
  });
}

/**
 * The statements prepared from here on that read the media table by folder,
 * or only those asking for an item waiting for its Undo (`pending`).
 */
function mediaByFolderStatements(pending = false): () => number {
  const prepare = vi.spyOn(db.sqlite, "prepare");
  return () =>
    prepare.mock.calls.filter(([text]) => {
      const sql = String(text);
      return (
        /from "media"/i.test(sql) &&
        /"folder_id" (=|in)/i.test(sql) &&
        (!pending || sql.includes("pending_mark"))
      );
    }).length;
}

describe("deleting a folder with a large subtree", () => {
  it("asks whether any of its items waits for its Undo in a few statements", async () => {
    const statements = mediaByFolderStatements(true);

    // Not empty, and asked to keep its contents: refused after the check.
    const refused = await folders.deleteFolder("root", false);

    expect(refused).toMatchObject({ success: false, statusCode: 400 });
    // 1,201 folders, every one asked, in runs of at most 998: two
    // statements, not 1,201.
    expect(statements()).toBe(2);
  });

  it("still finds an item waiting for its Undo in any folder of the subtree", async () => {
    for (const folder of ["sub-0000", "sub-0600", "sub-1199"]) {
      await itemIn(`waiting-${folder}`, folder);
    }
    await db.db.insert(db.schema.nextlyMeta).values({
      key: pendingDeleteKey("waiting-sub-0600"),
      value: JSON.stringify({}),
      updatedAt: new Date(),
    });

    const refused = await folders.deleteFolder("root", true);

    expect(refused).toMatchObject({ success: false, statusCode: 409 });
  });

  it("collects the items of every folder in it in a few statements", async () => {
    await itemIn("first", "sub-0000");
    await itemIn("last", `sub-${String(SUBFOLDERS - 1).padStart(4, "0")}`);
    const statements = mediaByFolderStatements();

    const deleted = await folders.deleteFolder("root", true);

    expect(deleted).toMatchObject({ success: true, deletedMedia: 2 });
    // The Undo check, then the items read in the transaction that locks and
    // removes them, whose retired sizes are read there too: two statements
    // each.
    expect(statements()).toBe(4);
  });
});
