import { describe, expect, it } from "vitest";

import { SESSION_MAX_AGE_MS } from "../../e2e/tests/support/session.mjs";

import { sessionRenewer } from "./capture.mjs";

/*
 * The session a run captures with holds an access token that lives fifteen
 * minutes, and a long batch of views outlasts it. Renewed once it is older
 * than the e2e suite's own safe age, every view starts with time to spare.
 */
describe("the session a run captures with", () => {
  const MINUTE = 60_000;

  function renewer() {
    let clock = 0;
    const signIns = [];
    const renew = sessionRenewer({
      baseURL: "http://localhost:1",
      file: "/tmp/session.json",
      signIn: async (baseURL, file) => signIns.push([baseURL, file, clock]),
      now: () => clock,
    });
    return { renew, signIns, at: minutes => (clock = minutes * MINUTE) };
  }

  it("is kept while it is younger than the suite's safe age", async () => {
    const { renew, signIns, at } = renewer();
    at(SESSION_MAX_AGE_MS / MINUTE - 1);
    await renew();
    expect(signIns).toEqual([]);
  });

  it("is signed in again once older than it, and kept again after", async () => {
    const { renew, signIns, at } = renewer();
    at(SESSION_MAX_AGE_MS / MINUTE + 1);
    await renew();
    expect(signIns).toEqual([
      ["http://localhost:1", "/tmp/session.json", SESSION_MAX_AGE_MS + MINUTE],
    ]);
    at(SESSION_MAX_AGE_MS / MINUTE + 2);
    await renew();
    expect(signIns).toHaveLength(1);
    at((2 * SESSION_MAX_AGE_MS) / MINUTE + 2);
    await renew();
    expect(signIns).toHaveLength(2);
  });

  it("leaves the suite's safe age under the token's fifteen minutes", () => {
    expect(SESSION_MAX_AGE_MS).toBeLessThan(15 * MINUTE);
  });
});
