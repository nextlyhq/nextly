/**
 * A plugin whose digest key was sealed under another secret says, at start,
 * which setting to change.
 *
 * A plugin's digest key is kept in `nextly_meta`, sealed under the secret the
 * database was run with. Started with a different `NEXTLY_SECRET`, as a copy
 * of a site's database is on another machine, the key cannot be opened and
 * the plugin cannot start. The start used to end with only "An unexpected
 * error occurred.", which names nothing to change. It must name the plugin
 * and the two settings that let the key be opened again, and never the key
 * or a secret.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdapter } from "../../../database/factory";
import { _resetEnvCache } from "../../../shared/lib/env";
import { definePlugin } from "../../plugin-context";
import { createTestNextly } from "../../test-nextly";

const FIRST = "first-secret-for-this-test-0123456789abcdef";
const OTHER = "other-secret-for-this-test-0123456789abcdef";

/** A plugin that makes and reads its digest key at start, as the form builder does. */
const keyed = definePlugin({
  name: "@test/keyed-at-start",
  version: "1.0.0",
  nextly: ">=0.0.0",
  async init(ctx) {
    await ctx.security.digests.prepare();
  },
});

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-digest-secret-"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/** A start on this test's database under `secret`. */
async function startUnder(secret: string) {
  vi.stubEnv("NEXTLY_SECRET", secret);
  _resetEnvCache();
  return createTestNextly({
    adapter: (await createAdapter({
      type: "sqlite",
      url: `file:${join(dir, "site.db")}`,
    } as Parameters<typeof createAdapter>[0])) as never,
    plugins: [keyed],
  });
}

describe("a plugin's digest key sealed under another secret", () => {
  it("stops the start naming the plugin and the settings that open the key", async () => {
    // The premise: under the secret it was made with, the plugin starts.
    const made = await startUnder(FIRST);
    await made.destroy();

    const failure = await startUnder(OTHER).then(
      started => started.destroy().then(() => undefined),
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain("@test/keyed-at-start");
    expect(message).toContain("NEXTLY_SECRET");
    expect(message).toContain("NEXTLY_SECRET_PREVIOUS");
    expect(message).not.toContain(FIRST);
    expect(message).not.toContain(OTHER);
  }, 120_000);
});
