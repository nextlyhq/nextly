/**
 * One case per CLI error code: a function that produces the value a command ends with for that
 * code's cause, as the code that throws it does.
 *
 * Where the thrower is a function that runs without a database, the case calls it; otherwise it
 * builds the error exactly as its throw site does, naming that site. `error-shape.test.ts`
 * snapshots each case, and `error-codes-registry.test.ts` holds each code's docs example to it.
 *
 * @module cli/__tests__/error-cases/types
 */
import type { CliErrorCode } from "../../errors";

/** Produces the thrown value for one cause. Paths in it use the project folder `/home/you/app`. */
export type ErrorCase = () => unknown | Promise<unknown>;

/** An area's cases: some of the codes, each at most once. */
export type ErrorCases = Partial<Record<CliErrorCode, ErrorCase>>;

/** The project folder every case's paths sit in, so the examples read the same everywhere. */
export const PROJECT = "/home/you/app";
