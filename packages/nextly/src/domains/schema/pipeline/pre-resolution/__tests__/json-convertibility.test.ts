// Where the SQLSTATE lives is a property of the DRIVER, and the driver is a property of the
// deployment. These cover that dimension without a server.
//
// The probe distinguishes "this column holds values that are not JSON" from "the probe could not
// run", and it does so by reading a SQLSTATE. Drizzle wraps the driver's error, so the code sits on
// `cause` rather than on the object thrown — and how many wrappers sit between the two differs by
// transport. A direct TCP connection nests it once; a serverless HTTP driver or a pooler can nest it
// deeper. Getting that wrong fails in the safe direction, but it fails on the deployment target
// rather than locally: a genuine bad-data migration would be reported as an infrastructure problem
// on the production database and never in a local run.
//
// A live-server suite cannot cover this, because it can only produce the shape its own driver makes.

import { describe, expect, it } from "vitest";

import { columnHoldsOnlyJson } from "../json-convertibility";

/** A handle whose every query fails with the given error. */
function failingWith(error: unknown) {
  return {
    execute: () => Promise.reject(error),
  };
}

/** The shape node-postgres produces, as Drizzle wraps it: one level down. */
function wrappedOnce(code: string): Error {
  const driverError = Object.assign(new Error("driver"), { code });
  return Object.assign(new Error("Failed query"), { cause: driverError });
}

/** A deeper nesting, as a serverless HTTP driver or a pooler can produce. */
function wrappedTwice(code: string): Error {
  return Object.assign(new Error("Failed query"), { cause: wrappedOnce(code) });
}

/**
 * Nested far deeper than any driver seen so far.
 *
 * The depth is the assertion. A walk bounded to some number of levels passes every shallow case and
 * only fails here, so without this the difference between "walks the chain" and "walks a few links
 * of it" is invisible — and that difference is exactly what a different transport would expose, in
 * production, where the shallow cases all still pass.
 */
function wrappedDeeply(code: string, levels = 12): Error {
  let error: Error = Object.assign(new Error("driver"), { code });
  for (let i = 0; i < levels; i++) {
    error = Object.assign(new Error(`wrapper ${i}`), { cause: error });
  }
  return error;
}

describe("columnHoldsOnlyJson — telling bad data apart from a probe that could not run", () => {
  it("reads a data exception however deeply the driver nests it", async () => {
    // 22P02 is what the malformed-JSON cast raises. The verdict must not depend on wrapper count.
    for (const error of [
      Object.assign(new Error("bare"), { code: "22P02" }),
      wrappedOnce("22P02"),
      wrappedTwice("22P02"),
      wrappedDeeply("22P02"),
    ]) {
      await expect(
        columnHoldsOnlyJson(failingWith(error), "t", "c", "postgresql")
      ).resolves.toBe(false);
    }
  });

  it("re-throws anything that is not a data exception, at every depth", async () => {
    // 42P01 missing table, 55P03 lock not available, 08006 connection failure. None of these is a
    // statement about the column's contents, and answering `false` for them would block a valid
    // migration while telling the operator to go and look at their rows.
    for (const code of ["42P01", "55P03", "08006"]) {
      for (const error of [
        wrappedOnce(code),
        wrappedTwice(code),
        wrappedDeeply(code),
      ]) {
        await expect(
          columnHoldsOnlyJson(failingWith(error), "t", "c", "postgresql")
        ).rejects.toBe(error);
      }
    }
  });

  it("re-throws an error carrying no SQLSTATE at all", async () => {
    // A thrown string, or a bug in this package, must not be laundered into a verdict about data.
    const plain = new Error("something else entirely");
    await expect(
      columnHoldsOnlyJson(failingWith(plain), "t", "c", "postgresql")
    ).rejects.toBe(plain);
  });

  it("terminates on a cause chain that points back at itself", async () => {
    // `cause` is an ordinary property and nothing stops it forming a cycle.
    //
    // This case is only able to FAIL rather than hang because the walk carries a link cap that
    // throws. Without the cap, dropping the visited-set would spin in a synchronous loop and block
    // the event loop, so vitest's timeout would never fire and the whole run would stall — an
    // unfalsifiable guard. With the cap, the same removal ends in a thrown internal error and this
    // assertion fails cleanly.
    const looped: { code: string; cause?: unknown } = { code: "42P01" };
    looped.cause = looped;
    await expect(
      columnHoldsOnlyJson(failingWith(looped), "t", "c", "postgresql")
    ).rejects.toBe(looped);
  });

  it("asks nothing of SQLite, where JSON is stored as text", async () => {
    // No cast happens, so no value can be rejected. The handle is deliberately one that would throw
    // if it were used.
    await expect(
      columnHoldsOnlyJson(
        failingWith(new Error("must not be queried")),
        "t",
        "c",
        "sqlite"
      )
    ).resolves.toBe(true);
  });
});
