/**
 * The revalidation after a stored upload, on a deployment missing a module
 * `next/cache` requires.
 *
 * A host that deploys each function with only its traced files can ship one,
 * since `next/cache` is loaded through a require no trace follows. The file
 * is already saved by then, so the revalidation is skipped and named rather
 * than failing the response; `next/cache` itself missing, or any other
 * failure, still throws as before.
 */
import { describe, expect, it, vi } from "vitest";

// The action's services, which this lookup never reaches, kept from loading
// the database adapters.
vi.mock("../../services", () => ({ ServiceContainer: class {} }));
vi.mock("../../di/container", () => ({
  container: { has: () => false, get: () => undefined },
}));

import { revalidatePathFrom } from "../upload-media";

/** Node's error for `missing` not being found, as `require` throws it. */
function moduleNotFound(missing: string): Error {
  return Object.assign(
    new Error(
      `Cannot find module '${missing}'\nRequire stack:\n- /var/task/x.js`
    ),
    { code: "MODULE_NOT_FOUND" }
  );
}

describe("finding revalidatePath", () => {
  it("hands back Next's revalidatePath when next/cache loads", () => {
    const revalidatePath = vi.fn();
    expect(revalidatePathFrom(() => ({ revalidatePath }))).toBe(revalidatePath);
  });

  it("skips the revalidation when a module next/cache requires is missing", () => {
    const revalidate = revalidatePathFrom(() => {
      throw moduleNotFound("next/dist/server/web/spec-extension/revalidate");
    });
    expect(() => revalidate("/admin/media")).not.toThrow();
  });

  it("rethrows where next/cache itself is missing", () => {
    const missing = moduleNotFound("next/cache");
    expect(() =>
      revalidatePathFrom(() => {
        throw missing;
      })
    ).toThrow(missing);
  });

  it("rethrows any other failure to load next/cache", () => {
    const broken = new SyntaxError("Unexpected token");
    expect(() =>
      revalidatePathFrom(() => {
        throw broken;
      })
    ).toThrow(broken);
  });
});
