// i18n: the collection schema apply must carry the builder's CURRENT
// Internationalization toggle, the way singleApi.applySchemaChanges does.
//
// The dispatcher prefers a request-supplied `localized` over the persisted
// registry flag precisely so one save can flip i18n AND change fields: without
// it the DDL diff runs against the pre-save flag, so the translatable columns
// are placed for the OLD localization state and the companion is never
// provisioned in that apply. The settings write that follows updates the flag
// but emits no DDL, which is why the value has to ride along here.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../lib/api/protectedApi", () => ({
  protectedApi: {
    post: vi.fn(async () => ({ message: "ok", newSchemaVersion: 2 })),
  },
}));

import { protectedApi } from "../../lib/api/protectedApi";
import { schemaApi } from "../schemaApi";

const post = protectedApi.post as unknown as ReturnType<typeof vi.fn>;

function bodyOfLastCall(): Record<string, unknown> {
  return post.mock.calls[0][1] as Record<string, unknown>;
}

describe("schemaApi.apply — localized flag", () => {
  beforeEach(() => post.mockClear());

  it("sends localized:true so the companion is provisioned in the same apply", async () => {
    await schemaApi.apply("posts", [], 1, undefined, undefined, true);
    expect(post.mock.calls[0][0]).toBe("/collections/schema/posts/apply");
    expect(bodyOfLastCall()).toMatchObject({
      confirmed: true,
      localized: true,
    });
  });

  it("sends localized:false so turning i18n off is applied, not read as absent", async () => {
    await schemaApi.apply("posts", [], 1, undefined, undefined, false);
    expect(bodyOfLastCall()).toMatchObject({ localized: false });
  });

  // Omission is not the same as false: the dispatcher falls back to the
  // persisted flag, which is what a caller with no opinion wants.
  it("omits the key entirely when no toggle is supplied", async () => {
    await schemaApi.apply("posts", [], 1);
    expect(bodyOfLastCall()).not.toHaveProperty("localized");
  });
});
