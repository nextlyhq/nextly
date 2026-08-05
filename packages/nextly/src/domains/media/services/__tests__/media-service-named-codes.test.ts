/**
 * The media services name the code they mean, and the boundary believes them.
 *
 * A status is coarser than a code: 409 covers both a folder-name clash and a
 * stale write, and they need opposite advice — "pick another name" versus
 * "reload". The boundary's shared table has to read 409 as `CONFLICT`, the
 * reading that is still safe if the other was meant, so a producer that knows
 * it means the clash has to say so.
 *
 * The second thing pinned here is what naming a code must NOT cost. The
 * boundary answers a refused-input failure with a field-anchored validation
 * error rather than the generic sentence a bare code carries, and that branch
 * used to be reached by the ABSENCE of a code. Naming one at the producer would
 * have silently switched every one of those failures to the generic answer.
 */
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { MediaService } from "../media-service";

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const ctx = {} as never;

/** A boundary whose folder service answers with the given envelope. */
function withFolderFailure(
  method: string,
  envelope: Record<string, unknown>
): MediaService {
  const folders = { [method]: vi.fn().mockResolvedValue(envelope) };
  return new MediaService(
    {} as never,
    folders as never,
    null,
    {} as never,
    {} as never,
    true,
    noopLogger as never
  );
}

describe("a media failure keeps the code its producer named", () => {
  it("answers a folder-name clash as DUPLICATE, not the status reading", async () => {
    const service = withFolderFailure("createFolder", {
      success: false,
      statusCode: 409,
      code: "DUPLICATE",
      message: "A folder with this name already exists in this location",
      data: null,
    });

    const thrown = (await service
      .createFolder({ name: "Photos" } as never, ctx)
      .catch((e: unknown) => e)) as NextlyError;

    expect(NextlyError.is(thrown)).toBe(true);
    // CONFLICT is what 409 alone would have produced, and it says "reload" —
    // advice that cannot rename anything.
    expect(thrown.code).toBe("DUPLICATE");
    expect(thrown.statusCode).toBe(409);
  });

  it("answers a missing folder as NOT_FOUND", async () => {
    const service = withFolderFailure("getFolderById", {
      success: false,
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Folder not found",
      data: null,
    });

    const thrown = (await service
      .findFolderById("f1", ctx)
      .catch((e: unknown) => e)) as NextlyError;

    expect(thrown.code).toBe("NOT_FOUND");
    expect(thrown.statusCode).toBe(404);
    // The identifier stays operator-side.
    expect(thrown.publicMessage).not.toContain("f1");
    expect(thrown.logContext).toMatchObject({
      entity: "folder",
      folderId: "f1",
    });
  });
});

describe("naming a code does not cost the actionable refusal", () => {
  it("still answers a refused folder update with a field-anchored error", async () => {
    const service = withFolderFailure("updateFolder", {
      success: false,
      statusCode: 400,
      code: "INVALID_INPUT",
      message: "Cannot move folder into its own subfolder",
      data: null,
    });

    const thrown = (await service
      .updateFolder("f1", { parentId: "f2" } as never, ctx)
      .catch((e: unknown) => e)) as NextlyError;

    // A validation error naming the field, not the generic sentence
    // `INVALID_INPUT` carries — which is what a boundary keyed on the ABSENCE
    // of a code would now produce.
    expect(thrown.code).toBe("VALIDATION_ERROR");
    expect(thrown.statusCode).toBe(400);
    expect(JSON.stringify(thrown.publicData)).toContain("folder");
  });

  it("still answers a non-empty folder delete with a field-anchored error", async () => {
    const service = withFolderFailure("deleteFolder", {
      success: false,
      statusCode: 400,
      code: "INVALID_INPUT",
      message:
        "Folder is not empty. Set deleteContents=true to delete all contents.",
    });

    const thrown = (await service
      .deleteFolder("f1", false, ctx)
      .catch((e: unknown) => e)) as NextlyError;

    expect(thrown.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(thrown.publicData)).toContain("deleteContents");
    // The hint names a parameter, so it is safe to keep operator-side only.
    expect(thrown.publicMessage).not.toContain("deleteContents=true");
  });

  it("still answers a producer that names no code at all", async () => {
    // The shape every media failure had before any of them named a code. The
    // branch has to keep recognising it, or a service not yet migrated loses
    // the actionable error it has always produced.
    const service = withFolderFailure("deleteFolder", {
      success: false,
      statusCode: 400,
      message: "Folder is not empty.",
    });

    const thrown = (await service
      .deleteFolder("f1", false, ctx)
      .catch((e: unknown) => e)) as NextlyError;

    expect(thrown.code).toBe("VALIDATION_ERROR");
  });

  it("does not divert a differently-coded 400 into the refusal branch", async () => {
    // A 400 that means something else must reach the converter and keep its
    // own code, or the branch would swallow every 400 the way the status test
    // it replaced did.
    const service = withFolderFailure("deleteFolder", {
      success: false,
      statusCode: 400,
      code: "EXTERNAL_URL_BLOCKED",
      message: "refused",
    });

    const thrown = (await service
      .deleteFolder("f1", false, ctx)
      .catch((e: unknown) => e)) as NextlyError;

    expect(thrown.code).toBe("EXTERNAL_URL_BLOCKED");
  });
});
