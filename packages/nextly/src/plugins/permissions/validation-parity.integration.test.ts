import { afterEach, describe, expect, it } from "vitest";

import { definePlugin } from "../../plugins";
import { createTestNextly } from "../../plugins/test-nextly";

let teardown: (() => Promise<void>) | undefined;
afterEach(async () => {
  await teardown?.();
  teardown = undefined;
});

const perm = (name: string) =>
  definePlugin({
    name,
    version: "1.0.0",
    nextly: ">=0.0.1",
    contributes: {
      permissions: [{ action: "export", resource: "submissions" }],
    },
  });

describe("custom-permission boot validation", () => {
  it("fails fast when two plugins declare the same custom permission", async () => {
    await expect(
      createTestNextly({ plugins: [perm("@acme/a"), perm("@acme/b")] })
    ).rejects.toMatchObject({ code: "NEXTLY_PERMISSION_COLLISION" });
  });

  it("boots cleanly with a single valid custom permission", async () => {
    const t = await createTestNextly({ plugins: [perm("@acme/a")] });
    teardown = t.destroy;
    expect(t.nextly).toBeTruthy();
  });
});
