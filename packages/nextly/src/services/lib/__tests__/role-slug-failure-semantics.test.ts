/**
 * Two readings of one role lookup, differing only in what a FAILURE means.
 *
 * `listRoleSlugsForUser` degrades a lookup error to an empty set. That is the
 * safe direction for a rule that grants on a role — no roles, no grant — and
 * the wrong direction for one that withholds on a role, since
 * `!roles.includes("restricted")` passes for a caller whose roles could not be
 * read. A caller that must tell "holds no roles" from "the database did not
 * answer" needs the strict reading.
 *
 * The failure is induced through the `executor` seam, so both functions run
 * their real lookup and fail at the query rather than at a mocked boundary.
 * What is asserted is the divergence itself: written as two separate lookups
 * they would drift, and the drift would be invisible because both would still
 * look correct.
 */
import { describe, expect, it } from "vitest";

import {
  listRoleSlugsForUser,
  listRoleSlugsForUserStrict,
} from "../permissions";

/** An executor that cannot answer, standing in for a database that will not. */
const refusing = {
  select: () => {
    throw new Error("connection refused");
  },
};

describe("role-slug lookup failure semantics", () => {
  it("reports a lookup failure as no roles, on the tolerant reading", async () => {
    await expect(listRoleSlugsForUser("u1", refusing)).resolves.toEqual([]);
  });

  // The separating property. Without it the two are one function with two
  // names, and a caller that chose the strict one FOR its failure behaviour
  // would silently get the tolerant one's.
  it("raises that same failure on the strict reading", async () => {
    await expect(listRoleSlugsForUserStrict("u1", refusing)).rejects.toThrow();
  });

  // And they agree where there is no lookup to fail at, so the divergence above
  // is about the failure rather than about two questions that were never the
  // same. An absent id names nobody on both readings.
  it("agrees on a caller that names nobody", async () => {
    expect(await listRoleSlugsForUser("", refusing)).toEqual([]);
    expect(await listRoleSlugsForUserStrict("", refusing)).toEqual([]);
  });
});
