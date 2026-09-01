/**
 * The DEFAULT adapter's read bounds.
 *
 * Tested separately from the cloud adapters because this is the one most
 * installs actually use, and a cap the cloud adapters keep while this one
 * ignores is a cap that does nothing in the commonest deployment. That is
 * exactly the shape the option had before: advertised on the contract, honoured
 * by some backends, silently inert on the default.
 *
 * @module storage/adapters/local-read-cap.test
 */
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isStorageReadTooLarge } from "../../read-errors";
import { LocalStorageAdapter } from "../local-adapter";

let base: string;
let adapter: LocalStorageAdapter;

beforeEach(async () => {
  // A real directory rather than a mocked `fs`: the cap is enforced from the
  // file's own reported size, so a fake would be asserting my arithmetic
  // against itself rather than against what the filesystem says.
  base = await mkdtemp(join(tmpdir(), "nextly-local-read-"));
  // `baseUrl` is required by the constructor, which reads it directly.
  adapter = new LocalStorageAdapter({ basePath: base, baseUrl: "/uploads" });
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("LocalStorageAdapter.read bounds", () => {
  it("reads a file that fits under the cap", async () => {
    await writeFile(join(base, "small.txt"), "hello");
    const bytes = await adapter.read("small.txt", { maxBytes: 100 });
    expect(bytes?.toString("utf8")).toBe("hello");
  });

  it("REFUSES a file larger than the cap", async () => {
    /*
     * Refused rather than read-then-checked. `readFile` buffers the whole
     * thing, so a cap applied afterwards has already spent the memory it exists
     * to save — which was the original defect on the cloud adapters and would
     * be the same one here.
     */
    await writeFile(join(base, "big.txt"), "x".repeat(500));
    const outcome = await adapter.read("big.txt", { maxBytes: 10 }).then(
      value => value,
      (error: unknown) => error
    );

    expect(isStorageReadTooLarge(outcome)).toBe(true);
    // NOT null: refusing a file that IS there is a different answer from not
    // finding one, and a caller told `null` would treat a present file as gone.
    expect(outcome).not.toBeNull();
  });

  it("reads without a cap when the caller names none", async () => {
    // The control for the refusal above: an adapter that refused every bounded
    // read would satisfy it while ignoring what the caller asked for.
    await writeFile(join(base, "big.txt"), "x".repeat(500));
    const bytes = await adapter.read("big.txt");
    expect(bytes?.length).toBe(500);
  });

  it("still answers null for a file that is not there", async () => {
    // The absence contract is unchanged by the cap — and this is the control
    // proving `null` still means "missing" rather than "this never answers".
    expect(await adapter.read("nope.txt", { maxBytes: 10 })).toBeNull();
  });
});
