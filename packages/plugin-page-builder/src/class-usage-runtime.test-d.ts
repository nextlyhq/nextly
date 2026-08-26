/**
 * Whether the structural Direct API this package declares is one the REAL
 * Direct API satisfies.
 *
 * A structural type is a restatement, and a restatement can be wrong while
 * everything built on it compiles and every test passes — the tests supply a
 * fake that matches the restatement, so they agree with the mistake rather than
 * with the runtime. That happened: `find` was declared as
 * `{ docs, hasNextPage }`, which is the collection SERVICE's inner payload and
 * not what the Direct API returns. Every index query answered an empty page, so
 * no stored row was ever found, nothing was removed, and each save re-inserted
 * rows it already had — with a green suite throughout.
 *
 * This is the assertion that could have failed: it compares the declaration
 * against the published type instead of against a belief about it.
 *
 * @module class-usage-runtime.test-d
 */
import type { Nextly } from "nextly";

import type { ClassUsageDirectApi } from "./class-usage-runtime";

/** The real instance is usable wherever this package asks for its own shape. */
const realApiSatisfiesTheDeclaredShape: Nextly extends ClassUsageDirectApi
  ? true
  : false = true;

/**
 * The control, and it is load-bearing.
 *
 * `X extends Y` is true for more things than it looks — a `Y` whose members
 * were all optional, or widened to `any`, would accept anything and the
 * assertion above would certify nothing. A shape that must NOT satisfy it has
 * to come out false.
 */
const anUnrelatedShapeDoesNot: { find: () => void } extends ClassUsageDirectApi
  ? true
  : false = false;

export { realApiSatisfiesTheDeclaredShape, anUnrelatedShapeDoesNot };
