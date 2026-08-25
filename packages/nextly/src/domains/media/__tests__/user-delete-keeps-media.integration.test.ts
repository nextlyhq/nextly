/**
 * Deleting a user must not destroy the files they uploaded.
 *
 * `media.uploadedBy` references `users.id`, and the reference carries an
 * ON DELETE rule that the DATABASE enforces — below every service, every hook
 * and every access check. Nothing in application code runs, so no test that
 * drives a service can see it: the only way to observe the rule is to delete a
 * user and look at what is left.
 *
 * An asset library is shared property. A logo uploaded by someone who has since
 * left is still the site's logo, and losing every file with the account is a
 * data-loss report rather than a tidy-up. The attribution is the part that
 * belongs to the person, and it is the part that goes.
 */
import { afterEach, describe, expect, it } from "vitest";

import { MediaService as LegacyMediaService } from "../../../services/media";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Upload one file attributed to `uploaderId`, and return its id. */
async function uploadAttributedTo(
  handle: TestNextly,
  uploaderId: string,
  filename: string
): Promise<string> {
  // The LEGACY service, because it is the only surface that takes `uploadedBy`
  // directly. The Direct API derives it from the request context, which this
  // harness has no session for — and an upload attributed to nobody cannot
  // exercise a rule about the uploader's account.
  const legacy = new LegacyMediaService(handle.adapter, console as never);
  const result = await legacy.uploadMedia({
    file: Buffer.from("x"),
    filename,
    mimeType: "application/pdf",
    size: 1,
    uploadedBy: uploaderId,
  });
  expect(result.success).toBe(true);
  return (result.data as { id: string }).id;
}

/**
 * The stored row, straight from the table — not through a service.
 *
 * The adapter maps columns back to their FIELD names, so this reads
 * `uploadedBy` rather than the `uploaded_by` the column is called. Reading the
 * column name yields `undefined`, which is indistinguishable from an upload
 * that never recorded an uploader — and would fail the control below while the
 * fixture was perfectly correct. It did, before this was fixed.
 */
async function readMediaRow(
  handle: TestNextly,
  mediaId: string
): Promise<{ id: string; uploadedBy: string | null } | undefined> {
  const rows = (await handle.adapter.select("media", {
    where: { and: [{ column: "id", op: "=", value: mediaId }] },
  })) as Array<{ id: string; uploadedBy?: string | null }>;
  const row = rows[0];
  return row ? { id: row.id, uploadedBy: row.uploadedBy ?? null } : undefined;
}

describe("deleting a user and their uploads", () => {
  it("keeps the files and clears only the attribution", async () => {
    current = await createTestNextly({});
    const handle = current;

    await handle.adapter.insert("users", {
      id: "departing-1",
      email: "departing-1@test.local",
    });
    const mediaId = await uploadAttributedTo(handle, "departing-1", "logo.pdf");

    // The fixture control, and it carries the test. If the row were not stored
    // against this user, deleting the user would leave it untouched for a
    // reason that has nothing to do with the rule under test, and the
    // assertion below would pass on a file no cascade could ever have reached.
    const before = await readMediaRow(handle, mediaId);
    expect(before?.uploadedBy).toBe("departing-1");

    await handle.nextly.users.delete({ id: "departing-1" });

    // The second control: the user really is gone. A delete that silently
    // failed leaves the media row present for the wrong reason.
    const remainingUsers = (await handle.adapter.select("users", {
      where: { and: [{ column: "id", op: "=", value: "departing-1" }] },
    })) as unknown[];
    expect(remainingUsers).toHaveLength(0);

    const after = await readMediaRow(handle, mediaId);
    expect(after, "the file must outlive the account").toBeDefined();
    expect(after?.uploadedBy).toBeNull();
  });
});
