/**
 * Reading the queue must not RUN it.
 *
 * The trigger accepts GET as well as POST, because Vercel Cron triggers with a
 * GET. That makes the verb useless as a discriminator: a list request and a
 * drain request are both `GET /api/jobs...`, and the only thing separating them
 * is the path. If the parser let a bare `/api/jobs` fall through to the trigger,
 * opening a read-only screen would drain the queue as a side effect — a write
 * performed by a page that advertises itself as a view.
 *
 * That is why these assert the METHOD the parser resolves rather than merely
 * that something parsed: both shapes resolve, and resolving is not the property
 * under test.
 */
import { describe, expect, it } from "vitest";

import { parseRestRoute } from "../route-parser";

describe("the jobs read is distinct from the jobs trigger", () => {
  it("parses GET /api/jobs as a list", () => {
    expect(parseRestRoute(["jobs"], "GET")).toMatchObject({
      service: "jobs",
      method: "listJobs",
    });
  });

  it("does NOT resolve a bare read to the runner", () => {
    // The defect this file exists for, stated as its own case: a fall-through
    // would satisfy the test above only if it also named `runJobs`, which is
    // exactly what must not happen.
    expect(parseRestRoute(["jobs"], "GET")).not.toMatchObject({
      method: "runJobs",
    });
  });

  it("still parses the trigger, under both verbs it accepts", () => {
    for (const verb of ["GET", "POST"]) {
      expect(parseRestRoute(["jobs", "run"], verb)).toMatchObject({
        service: "jobs",
        method: "runJobs",
      });
    }
  });

  /*
   * A read is a read. Offering the list under a write verb would give the
   * endpoint two meanings and invite a caller to POST to it expecting an
   * effect.
   */
  it("offers the list under GET only", () => {
    for (const verb of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(parseRestRoute(["jobs"], verb)).not.toMatchObject({
        method: "listJobs",
      });
    }
  });
});
