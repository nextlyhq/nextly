/**
 * What the admin knows about the history entry behind the current one, for
 * browsers without the Navigation API, which can't be asked.
 *
 * @module lib/__tests__/admin-history.test
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  entryBehindIsAdmin,
  forgetEntryBehind,
  recordPushFrom,
} from "@admin/lib/admin-history";

beforeEach(() => {
  forgetEntryBehind();
});

describe("the entry behind the current one", () => {
  it("is unknown before the admin has moved anywhere", () => {
    // A fresh load: only the referrer, read elsewhere, can say.
    expect(entryBehindIsAdmin()).toBeUndefined();
  });

  it("is an admin page after a move from one", () => {
    recordPushFrom("/admin/collections/posts");
    expect(entryBehindIsAdmin()).toBe(true);
  });

  it("is the admin's root after a move from the dashboard", () => {
    recordPushFrom("/admin");
    expect(entryBehindIsAdmin()).toBe(true);
  });

  it("is not the admin after a move from the site it runs in", () => {
    recordPushFrom("/");
    expect(entryBehindIsAdmin()).toBe(false);
  });

  it("reads the path by segment, so a sibling of /admin is not the admin", () => {
    recordPushFrom("/administrator");
    expect(entryBehindIsAdmin()).toBe(false);
  });

  it("is unknown again once the user jumps through history", () => {
    // Back or forward lands on an entry whose own predecessor this never saw.
    recordPushFrom("/admin/collections/posts");
    forgetEntryBehind();
    expect(entryBehindIsAdmin()).toBeUndefined();
  });

  it("follows the latest move, not the first", () => {
    recordPushFrom("/");
    recordPushFrom("/admin/collections/posts");
    expect(entryBehindIsAdmin()).toBe(true);
  });
});
