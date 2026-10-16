/**
 * The content a reader HAS, as the `collections:present` and `singles:present` conditions ask
 * it: the registry's readable listing, less what the dashboard keeps off.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// The shared allowlist is the seam: it is what the list endpoints scope by, and this module
// narrows it. Mocked so the case can put any slugs in reach without the RBAC stack.
const { allowlist } = vi.hoisted(() => ({ allowlist: vi.fn() }));
vi.mock("../../../services/lib/readable-slug-allowlist", () => ({
  readableSlugAllowlist: (caller: unknown, kind: string) =>
    allowlist(caller, kind) as unknown,
}));

import { recordKeptOffDashboard } from "../kept-off-dashboard";
import {
  readableCollectionSlugs,
  readableSingleSlugs,
} from "../reader-content";

const caller = { user: { id: "admin-1", roles: ["super-admin"] } };

afterEach(() => {
  // The record is process-wide; leave none behind for the next case.
  recordKeptOffDashboard("collection", []);
  recordKeptOffDashboard("single", []);
});

describe("the content a reader has, for offering a content card", () => {
  it("leaves out a collection kept off the dashboard, though the reader may read it", async () => {
    // A super-admin reads everything, the page builder's internal index included. Counted as
    // content, it would offer a card that then leaves it out and draws empty.
    allowlist.mockResolvedValue(["posts", "nx_pb_class_usage"]);
    recordKeptOffDashboard("collection", [
      { slug: "posts" },
      { slug: "nx_pb_class_usage", admin: { hidden: true } },
    ]);

    expect(await readableCollectionSlugs(caller)).toEqual(["posts"]);
  });

  it("leaves out a Single kept off the dashboard, and only from its own kind", async () => {
    // A collection and a Single may share a slug, so a hidden collection named "settings" must
    // not take the Single of that name with it.
    allowlist.mockResolvedValue(["settings", "hidden-single"]);
    recordKeptOffDashboard("single", [
      { slug: "hidden-single", admin: { hidden: true } },
    ]);
    recordKeptOffDashboard("collection", [
      { slug: "settings", admin: { hidden: true } },
    ]);

    expect(await readableSingleSlugs(caller)).toEqual(["settings"]);
  });

  it("keeps everything the reader may read when nothing is kept off", async () => {
    // The control: without a record, the listing is the allowlist unchanged.
    allowlist.mockResolvedValue(["posts", "pages"]);

    expect(await readableCollectionSlugs(caller)).toEqual(["posts", "pages"]);
  });
});
