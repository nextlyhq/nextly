/**
 * The Lucide set's data is loaded on first use. A load that fails, as a
 * browser's chunk fetch can on a flaky network, must not be kept: the next
 * search tries the load again rather than replaying the failure.
 *
 * @module lucide-load.test
 */
import { describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({ failNextLoad: true }));

vi.mock("./lucide-data", async importOriginal => {
  if (data.failNextLoad) {
    data.failNextLoad = false;
    throw new Error("The data chunk could not be fetched.");
  }
  return importOriginal();
});

describe("loading the Lucide set", () => {
  it("tries a failed load again on the next search", async () => {
    const { searchLucideIcons } = await import("./lucide");
    const outcome = (): Promise<string> =>
      searchLucideIcons("star").then(
        found => found[0]?.id ?? "nothing",
        () => "failed"
      );
    expect(await outcome()).toBe("failed");
    expect(await outcome()).toBe("lucide:star");
  });
});
