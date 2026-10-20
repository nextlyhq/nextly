/**
 * What a FAILED role lookup means: a refusal, never an empty role set.
 *
 * An empty set is the safe direction for a rule that grants on a role (no
 * roles, no grant) and the wrong one for a rule that withholds on a role, which
 * passes for a caller whose roles could not be read. So `listRoleSlugsForUser`,
 * the reading rules are handed, refuses the way the strict reading fails:
 * "database busy" when the read waited out its connection bound, an internal
 * error otherwise.
 *
 * The failure is induced through the `executor` seam, so the real lookup runs
 * and fails at the query rather than at a mocked boundary.
 */
import { poolWaitTimeoutError } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import {
  listRoleSlugsForUser,
  listRoleSlugsForUserStrict,
} from "../permissions";

/** An executor whose query fails with `error`, standing in for the database. */
function failingWith(error: Error) {
  return {
    select: () => {
      throw error;
    },
  };
}

const refusing = failingWith(new Error("connection refused"));

describe("role-slug lookup failure semantics", () => {
  it("refuses a lookup failure rather than reporting no roles", async () => {
    await expect(listRoleSlugsForUser("u1", refusing)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });

  it("refuses a lookup that waited out its connection bound as database busy", async () => {
    const busy = failingWith(poolWaitTimeoutError(15000));
    await expect(listRoleSlugsForUser("u1", busy)).rejects.toMatchObject({
      code: "DATABASE_BUSY",
      statusCode: 503,
    });
  });

  it("raises that same failure on the strict reading", async () => {
    await expect(listRoleSlugsForUserStrict("u1", refusing)).rejects.toThrow();
  });

  // Where there is no lookup to fail at, both answer: an absent id names
  // nobody, which is a real empty set rather than a failure.
  it("agrees on a caller that names nobody", async () => {
    expect(await listRoleSlugsForUser("", refusing)).toEqual([]);
    expect(await listRoleSlugsForUserStrict("", refusing)).toEqual([]);
  });
});
