/**
 * The DEFAULT adapter's read bounds.
 *
 * Tested separately from the cloud adapters because this is the one most
 * installs actually use, and a cap the cloud adapters keep while this one
 * ignores is a cap that does nothing in the commonest deployment. That is
 * exactly the shape the option had before: advertised on the contract, honoured
 * by some backends, silently inert on the default.
 *
 * The deadline is tested through a FIFO, which is the one thing a test can
 * make behave like the stalled network mount this bound exists for: opening
 * one for reading blocks until a writer arrives, and a filesystem call takes
 * no abort signal, so nothing else in the process can interrupt it.
 *
 * @module storage/adapters/local-read-cap.test
 */
import { execFile, execFileSync } from "node:child_process";
import { createWriteStream, mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isStorageReadTimeout, isStorageReadTooLarge } from "../../read-errors";
import { LocalStorageAdapter } from "../local-adapter";

/**
 * Whether this machine can make a FIFO at all.
 *
 * Windows has no `mkfifo`, and a minimal container may not ship it either, so
 * the two cases below would fail on setup rather than on the property they
 * name — turning an unsupported facility into a broken suite for a contributor
 * whose platform this package otherwise supports.
 *
 * Probed by MAKING one rather than by reading `process.platform`, because the
 * absence that matters is the utility's, and a platform list is a proxy that
 * goes stale. The skip is visible in the run summary, so a machine that cannot
 * exercise these reports that rather than reporting coverage it does not have.
 */
const CAN_MAKE_FIFO = ((): boolean => {
  // The DIRECTORY is what gets removed, not just the node inside it: removing
  // only the child left an empty `nextly-fifo-probe-*` behind in the system
  // temp directory on every evaluation of this module, succeed or fail.
  const probeDir = mkdtempSync(join(tmpdir(), "nextly-fifo-probe-"));
  try {
    execFileSync("mkfifo", [join(probeDir, "probe")], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
})();

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

  it("reads under the DEFAULT cap when the caller names none", async () => {
    /*
     * Not "without a cap": naming none now means the shared default, the same
     * one `safeFetch` gives the URL-backed adapters. This file is far under it,
     * so it reads — which is also the control for the refusal above, since an
     * adapter refusing every bounded read would satisfy that case while
     * ignoring what the caller asked for.
     */
    await writeFile(join(base, "big.txt"), "x".repeat(500));
    const bytes = await adapter.read("big.txt");
    expect(bytes?.length).toBe(500);
  });

  it.skipIf(!CAN_MAKE_FIFO)(
    "REFUSES bytes past the cap even when the metadata says zero",
    async () => {
      /*
       * The cap has to hold against what ARRIVES, not against what `stat`
       * reported a moment earlier. A FIFO makes that gap total rather than
       * racy: it reports a size of zero and then delivers whatever its writer
       * sends, so a cap taken from metadata passes it unconditionally.
       *
       * Its control is "REFUSES a file larger than the cap" above, which fails
       * if the refusal stops working at all; this one fails only when the
       * refusal is being decided by the wrong number.
       */
      const pipe = join(base, "pipe");
      await promisify(execFile)("mkfifo", [pipe]);

      // Started before the writer, because opening either end of a FIFO blocks
      // until the other end is open.
      const reading = adapter.read("pipe", { maxBytes: 1000, timeoutMs: 5000 });
      const writer = createWriteStream(pipe);
      // The reader refuses and closes mid-stream, so the write end breaks; that
      // is the expected end of this pipe, not a failure of the case.
      writer.on("error", () => undefined);
      writer.end(Buffer.alloc(200_000));

      const outcome = await reading.then(
        value => value,
        (error: unknown) => error
      );
      expect(isStorageReadTooLarge(outcome)).toBe(true);
      // NOT the 200_000 bytes it was sent, which is what a metadata-only cap
      // would have buffered and returned.
      expect(Buffer.isBuffer(outcome)).toBe(false);
    }
  );

  it.skipIf(!CAN_MAKE_FIFO)(
    "gives up on a read that never gets going, rather than hanging",
    async () => {
      /*
       * A FIFO with no writer stands in for the `basePath` on an unresponsive
       * mount: `open` blocks in the threadpool, takes no signal, and cannot be
       * interrupted — so the deadline can only be honoured by racing it.
       */
      const stalled = join(base, "stalled");
      await promisify(execFile)("mkfifo", [stalled]);

      const outcome = await adapter.read("stalled", { timeoutMs: 50 }).then(
        value => value,
        (error: unknown) => error
      );

      /*
       * A `NextlyError`, not the platform `DOMException` `AbortSignal.timeout`
       * rejects with. Product code in this package answers in one vocabulary, so
       * a caller can classify what it caught rather than matching a name the
       * runtime chose.
       */
      expect(isStorageReadTimeout(outcome)).toBe(true);
      // 504, because the failure is the BACKEND not answering — which a caller
      // may retry — rather than an internal fault, which it may not.
      expect((outcome as { statusCode?: number }).statusCode).toBe(504);
      // NOT the over-cap refusal: that one read the object and found it too big,
      // this one never read it at all.
      expect(isStorageReadTooLarge(outcome)).toBe(false);
      // NOT null: a backend that cannot be reached has said nothing about
      // whether the file is there, and a caller told `null` would treat it as
      // deleted and write a replacement over a file still sitting on the mount.
      expect(outcome).not.toBeNull();

      /*
       * The abandoned `open` still holds a libuv threadpool thread, which it
       * keeps for the life of the process unless a writer turns up. Released
       * here so this case cannot starve the ones after it.
       */
      const releasing = createWriteStream(stalled);
      releasing.on("error", () => undefined);
      /*
       * AWAITED, because `end()` only schedules the open and the close. The
       * teardown after this case removes the fifo, and doing that while the
       * abandoned `open` is still pending races the very thing this release
       * exists to unblock — leaving the threadpool slot held after all, on a
       * run that reported the case as passing.
       */
      await new Promise<void>(resolve => {
        releasing.on("close", () => {
          resolve();
        });
        releasing.end();
      });
    }
  );

  it("still answers null for a file that is not there", async () => {
    // The absence contract is unchanged by the cap — and this is the control
    // proving `null` still means "missing" rather than "this never answers".
    expect(await adapter.read("nope.txt", { maxBytes: 10 })).toBeNull();
  });
});
