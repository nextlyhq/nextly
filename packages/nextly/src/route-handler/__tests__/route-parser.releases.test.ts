/**
 * `/api/releases` — a top-level surface for a first-class object.
 *
 * A release is not a sub-resource of the documents it batches: it has its own
 * lifecycle, and it is the only shape that answers "what is going live on
 * Friday?" without starting from a document. So the risks are the ones a new
 * top-level branch carries — that it claims paths belonging to neighbours, that
 * the verb gates are real, and that a deeper path silently matches a shorter
 * route and ignores the tail.
 *
 * @module route-handler/__tests__/route-parser.releases.test
 */
import { describe, expect, it } from "vitest";

import { parseRestRoute } from "../route-parser";

describe("releases routes", () => {
  it("lists and creates at the collection root", () => {
    expect(parseRestRoute(["releases"], "GET")).toMatchObject({
      service: "releases",
      method: "listReleases",
    });
    expect(parseRestRoute(["releases"], "POST")).toMatchObject({
      service: "releases",
      method: "createRelease",
    });
  });

  it("reads one release by id", () => {
    expect(parseRestRoute(["releases", "r1"], "GET")).toMatchObject({
      service: "releases",
      method: "getRelease",
      routeParams: { releaseId: "r1" },
    });
  });

  it("separates schedule from cancel, and both from assembling", () => {
    // The distinction the seed makes and this surface must preserve: putting a
    // document into a release changes nothing a reader can see, while
    // committing it to an instant is what puts content live.
    expect(parseRestRoute(["releases", "r1", "schedule"], "POST").method).toBe(
      "scheduleRelease"
    );
    expect(parseRestRoute(["releases", "r1", "cancel"], "POST").method).toBe(
      "cancelRelease"
    );
    expect(parseRestRoute(["releases", "r1", "members"], "POST").method).toBe(
      "addReleaseMember"
    );
  });

  it("routes members by verb, and one member by id", () => {
    expect(parseRestRoute(["releases", "r1", "members"], "GET")).toMatchObject({
      method: "listReleaseMembers",
      routeParams: { releaseId: "r1" },
    });
    expect(
      parseRestRoute(["releases", "r1", "members", "m1"], "DELETE")
    ).toMatchObject({
      method: "removeReleaseMember",
      routeParams: { releaseId: "r1", memberId: "m1" },
    });
  });

  it("claims only the verb each route declares", () => {
    // A branch that ignored the verb would turn a read into a schedule, or let
    // a GET remove a member. Each case below is a route that must NOT match.
    expect(
      parseRestRoute(["releases", "r1", "schedule"], "GET").method
    ).not.toBe("scheduleRelease");
    expect(parseRestRoute(["releases", "r1", "cancel"], "GET").method).not.toBe(
      "cancelRelease"
    );
    expect(
      parseRestRoute(["releases", "r1", "members", "m1"], "GET").method
    ).not.toBe("removeReleaseMember");
    expect(parseRestRoute(["releases", "r1"], "DELETE").method).not.toBe(
      "getRelease"
    );
  });

  it("claims nothing deeper than the routes it declares", () => {
    // Unlike the entry publish-all branch, this surface guards its depth: a
    // longer path 404s rather than matching a shorter route and ignoring the
    // tail, which would make `.../schedule/tomorrow` schedule the release.
    expect(
      parseRestRoute(["releases", "r1", "schedule", "tomorrow"], "POST").method
    ).not.toBe("scheduleRelease");
    expect(
      parseRestRoute(["releases", "r1", "members", "m1", "extra"], "DELETE")
        .method
    ).not.toBe("removeReleaseMember");
  });

  it("does not claim a collection named releases", () => {
    // The reason the permission resource is `content-releases` and not
    // `releases`: "press releases" is a collection real sites have. A site's own
    // collection lives under /api/collections/releases and must be untouched.
    expect(
      parseRestRoute(["collections", "releases", "entries"], "GET").service
    ).toBe("collections");
  });
});
