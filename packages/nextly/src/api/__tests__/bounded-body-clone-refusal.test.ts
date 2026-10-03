/**
 * The bounded reader has to refuse an oversized CLONE, not hang on one.
 *
 * `Request.clone()` tees the body, and a tee branch's `cancel()` resolves only
 * once BOTH branches are cancelled. Awaiting it while leaving the original for
 * a handler waits on a promise nothing can settle — so the size refusal, the
 * one path written to stop an oversized request cheaply, became the most
 * expensive outcome a caller could ask for.
 */
import { describe, expect, it } from "vitest";

import { readBoundedJsonBody } from "../read-json-body";

const CHUNK = 4096;

/** A body that reports how much of it was actually taken. */
function countingBody(chunks: number): {
  stream: ReadableStream<Uint8Array>;
  read: () => number;
} {
  let sent = 0;
  let bytes = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= chunks) {
        controller.close();
        return;
      }
      sent += 1;
      bytes += CHUNK;
      controller.enqueue(new Uint8Array(CHUNK).fill(0x20));
    },
  });
  return { stream, read: () => bytes };
}

function streamed(body: ReadableStream<Uint8Array>): Request {
  return new Request("http://localhost/x", {
    method: "POST",
    body,
    // Required by undici for a streamed request body.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("readBoundedJsonBody on a cloned request", () => {
  it("refuses an oversized body instead of hanging", async () => {
    const body = countingBody(256);
    const req = streamed(body.stream);

    // The refusal must arrive on its own. Raced against a timer because the
    // defect this covers is not a wrong answer but the ABSENCE of one: a
    // plain await would fail by exhausting the suite timeout, which reads as
    // an infrastructure problem rather than as this bug.
    const outcome = await Promise.race([
      readBoundedJsonBody(req.clone(), 16 * CHUNK).then(
        () => "resolved",
        (err: unknown) => (err instanceof Error ? "refused" : "odd")
      ),
      new Promise<string>(resolve => setTimeout(() => resolve("hung"), 2000)),
    ]);

    expect(outcome).toBe("refused");
    // And it stopped near the cap rather than draining the 256 chunks on
    // offer. Three chunks of slack over the 16-chunk cap: the chunk that
    // crosses it, plus the one the Request constructor primes the stream with
    // and the one `clone()` primes the second branch with.
    expect(body.read()).toBeLessThanOrEqual(19 * CHUNK);
  });

  it("leaves the original request readable", async () => {
    // The whole reason to read a clone: the handler still gets its body.
    const req = streamed(countingBody(1).stream);
    const clone = req.clone();

    await expect(readBoundedJsonBody(clone, 8)).rejects.toThrow();
    await expect(req.text()).resolves.toHaveLength(CHUNK);
  });
});
