/**
 * The plugin-facing facade routes every failure through the shared converter.
 *
 * Five methods carried an identical copy of the same short-circuit: a code-less
 * 404 and a code-less 403 threw a generic factory before the converter was
 * reached. The converter answers those two statuses with the same generic
 * error, so the copies changed nothing a caller sees and cost those two
 * outcomes the failure they came from.
 *
 * The equivalence is the load-bearing claim, so it is asserted rather than
 * argued: the public code, status and message must be what the short-circuit
 * produced, and the identifiers must still be absent from the public message.
 */
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { errorEnvelopeFields } from "../../../errors/from-service-envelope";

import { CollectionService } from "./collection-service";

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function make(entry: Record<string, unknown>): CollectionService {
  return new CollectionService(
    {} as never,
    noopLogger as never,
    {} as never,
    entry as never
  );
}

/** A failed envelope as the entry service builds one. */
function failure(
  statusCode: number,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    success: false,
    statusCode,
    message: "owner rule denied: user 42 is not the author",
    data: null,
    ...extra,
  };
}

const ctx = { overrideAccess: true } as never;

/** Every method that carried a copy of the short-circuit. */
const METHODS: Array<{
  name: string;
  entryMethod: string;
  call: (s: CollectionService) => Promise<unknown>;
}> = [
  {
    name: "findEntryById",
    entryMethod: "getEntry",
    call: s => s.findEntryById("posts", "e1", ctx),
  },
  {
    name: "updateEntry",
    entryMethod: "updateEntry",
    call: s => s.updateEntry("posts", "e1", { title: "x" }, ctx),
  },
  {
    name: "deleteEntry",
    entryMethod: "deleteEntry",
    call: s => s.deleteEntry("posts", "e1", ctx),
  },
];

describe("a code-less failure keeps the error the short-circuit produced", () => {
  it.each(METHODS)(
    "$name answers 404 as a generic NOT_FOUND",
    async ({ entryMethod, call }) => {
      const entry = {
        [entryMethod]: vi.fn().mockResolvedValue(failure(404)),
      };

      const thrown = await call(make(entry)).catch((e: unknown) => e);

      expect(NextlyError.is(thrown)).toBe(true);
      const error = thrown as NextlyError;
      expect(error.code).toBe("NOT_FOUND");
      expect(error.statusCode).toBe(404);
      expect(error.publicMessage).toBe("Not found.");
    }
  );

  it.each(METHODS)(
    "$name answers 403 as a generic FORBIDDEN with the inner reason withheld",
    async ({ entryMethod, call }) => {
      const entry = {
        [entryMethod]: vi.fn().mockResolvedValue(failure(403)),
      };

      const thrown = (await call(make(entry)).catch(
        (e: unknown) => e
      )) as NextlyError;

      expect(thrown.code).toBe("FORBIDDEN");
      expect(thrown.statusCode).toBe(403);
      // The envelope's message names the rule and the user id. §13.8 keeps
      // that off the wire, which the deleted short-circuit did by dropping it
      // and the converter does by not reading it for a code-less status.
      expect(thrown.publicMessage).not.toContain("user 42");
      expect(thrown.logContext).toMatchObject({
        entity: "entry",
        collectionName: "posts",
        entryId: "e1",
      });
    }
  );

  it.each(METHODS)(
    "$name now carries the failure the envelope came from",
    async ({ entryMethod, call }) => {
      // What the short-circuit cost. It returned before the converter, so the
      // two most common outcomes of a failed facade call named nothing.
      const original = new Error("connection terminated unexpectedly");
      const entry = {
        [entryMethod]: vi
          .fn()
          .mockResolvedValue(failure(404, errorEnvelopeFields(original))),
      };

      const thrown = (await call(make(entry)).catch(
        (e: unknown) => e
      )) as NextlyError;

      expect(thrown.cause).toBe(original);
    }
  );
});

describe("a typed failure still answers as itself", () => {
  it.each(METHODS)(
    "$name keeps a plugin's own code through a 404",
    async ({ entryMethod, call }) => {
      // The short-circuit was guarded on `!result.code` for this reason, so the
      // guard has to survive its deletion: a typed 404 must not collapse into
      // the generic one.
      const entry = {
        [entryMethod]: vi.fn().mockResolvedValue(
          failure(404, {
            code: "ARCHIVE_EXPIRED",
            message: "That archive is no longer available.",
          })
        ),
      };

      const thrown = (await call(make(entry)).catch(
        (e: unknown) => e
      )) as NextlyError;

      expect(thrown.code).toBe("ARCHIVE_EXPIRED");
      expect(thrown.statusCode).toBe(404);
      expect(thrown.publicMessage).toBe("That archive is no longer available.");
    }
  );
});
