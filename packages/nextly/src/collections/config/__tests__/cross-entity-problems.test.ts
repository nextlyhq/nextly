/**
 * The configuration's rules across entities, each problem at the place of the entity that breaks
 * it, beside any problem of that entity's own.
 */
import { describe, expect, it } from "vitest";

import { crossEntityProblems } from "../cross-entity-problems";

describe("two Singles at one address, one of them with a slug that is not a string", () => {
  // The slug is that Single's own problem; the address it shares is reported as well.
  it("is reported at the second Single's address, naming it by its place", () => {
    const problems = crossEntityProblems({
      singles: [
        { slug: "home", fields: [], publicAddress: "/" },
        { slug: 7, fields: [], publicAddress: "/" },
      ],
    });

    expect(problems).toEqual([
      expect.objectContaining({
        path: "singles[1].publicAddress",
        code: "PUBLIC_ADDRESS_TAKEN",
        message: expect.stringContaining('"singles[1]"'),
      }),
    ]);
  });
});
