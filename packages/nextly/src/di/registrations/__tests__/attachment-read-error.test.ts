/**
 * Which error an author sees when a stored attachment cannot be read.
 *
 * This rule regressed silently once. Implementing `read` on the cloud adapters
 * moved the attachment path off a capped fetch onto an unbounded buffer, and
 * nothing failed — because the rule lived in a closure inside a DI factory,
 * where nothing could reach it. Break-verifying the fix is what exposed that:
 * removing the cap broke no test at all.
 *
 * So the mapping is asserted here, on the exported function, rather than
 * through a container.
 *
 * @module di/registrations/attachment-read-error.test
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { EmailErrorCode } from "../../../domains/email/errors";
import { StorageReadTooLargeError } from "../../../storage/read-errors";
import { asAttachmentReadError } from "../register-email";

describe("an attachment that could not be read", () => {
  it("reports an over-cap read as a SIZE error the author can act on", () => {
    /*
     * `attachment-resolver` passes through only `VALIDATION_ERROR` and wraps
     * everything else as an opaque storage failure. So an over-cap read that
     * arrives as anything else tells the author their storage broke, when what
     * happened is that their attachment is too big — a fixable refusal turned
     * into one they can do nothing about.
     */
    const mapped = asAttachmentReadError(
      new StorageReadTooLargeError("media/big.pdf", 1000, 5000),
      1000
    );

    expect(NextlyError.is(mapped)).toBe(true);
    // VALIDATION_ERROR specifically: it is the ONLY code the resolver lets
    // through, so any other code is silently rewritten downstream.
    expect((mapped as NextlyError).code).toBe("VALIDATION_ERROR");
  });

  it("names the attachment-size code, not merely some validation error", () => {
    const mapped = asAttachmentReadError(
      new StorageReadTooLargeError("media/big.pdf", 1000, 5000),
      1000
    ) as NextlyError & { publicData?: { errors?: { code?: string }[] } };

    /*
     * Read from `publicData`, which is where `NextlyError.validation` puts the
     * per-field list and therefore what a caller actually receives. Measured
     * rather than assumed: an earlier version of this case read `data` and
     * asserted against an empty array, which passes for a mapper that names no
     * code at all.
     */
    const codes = (mapped.publicData?.errors ?? []).map(e => e.code);
    expect(codes).toContain(EmailErrorCode.ATTACHMENT_SIZE_EXCEEDED);
  });

  it("returns any OTHER failure unchanged, for the resolver to wrap", () => {
    /*
     * The control, and it has to be able to come out different: a mapper that
     * translated everything would satisfy both cases above while reporting a
     * timeout or a refused address as "your file is too big" — a confident
     * wrong diagnosis, which is worse than an opaque one.
     *
     * Identity rather than shape, because "unchanged" is the claim: a copy
     * carrying the same fields would lose the cause the resolver logs.
     */
    const other = new Error("connection reset");
    expect(asAttachmentReadError(other, 1000)).toBe(other);
  });

  it("leaves a non-Error value alone too", () => {
    // Nothing guarantees a thrown value is an Error. Mapping one by accident
    // would replace a diagnosable oddity with a confident wrong sentence.
    expect(asAttachmentReadError("nope", 1000)).toBe("nope");
  });
});
