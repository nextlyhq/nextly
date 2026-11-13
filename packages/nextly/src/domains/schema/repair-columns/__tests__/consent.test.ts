/**
 * Which data-loss consent covers clearing a lossy column's values: only one that names that column,
 * as `table.column`. A consent without a list, or one naming only the table, never does, and says
 * why, with the consent that would.
 */
import { describe, expect, it } from "vitest";

import {
  NO_CONSENT,
  resolveDataLossConsent,
} from "../../migrate/data-loss-consent";
import { consentForColumn } from "../consent";

const flag = (value: string | true) => resolveDataLossConsent({ flag: value });
const env = (value: string) =>
  resolveDataLossConsent({ env: { NEXTLY_ACCEPT_DATA_LOSS: value } });

describe("consentForColumn", () => {
  it("no consent covers nothing and needs no notice", () => {
    expect(consentForColumn(NO_CONSENT, "dc_posts", "meta")).toEqual({
      covered: false,
      notice: null,
      flag: "--accept-data-loss=dc_posts.meta",
    });
  });

  it("a consent naming this column covers it, from the flag or the environment", () => {
    for (const consent of [
      flag("dc_posts.meta"),
      flag("dc_pages,dc_posts.meta"),
      env("dc_posts.meta"),
    ]) {
      expect(consentForColumn(consent, "dc_posts", "meta")).toMatchObject({
        covered: true,
        notice: null,
      });
    }
  });

  it("matches the name exactly as the report prints it, as every command matches the consent", () => {
    // PostgreSQL can hold "Posts" beside "posts": a consent for one never covers the other.
    expect(
      consentForColumn(flag("DC_Posts.Meta"), "dc_posts", "meta").covered
    ).toBe(false);
    expect(consentForColumn(flag("Posts.meta"), "Posts", "meta").covered).toBe(
      true
    );
  });

  it("a consent naming another column does not cover it, and gives no notice", () => {
    expect(consentForColumn(flag("dc_posts.body"), "dc_posts", "meta")).toEqual(
      {
        covered: false,
        notice: null,
        flag: "--accept-data-loss=dc_posts.meta",
      }
    );
  });

  it("a blanket consent never covers it, and says to name the column", () => {
    for (const consent of [flag(true), env("1"), env("true")]) {
      const verdict = consentForColumn(consent, "dc_posts", "meta");
      expect(verdict.covered).toBe(false);
      expect(verdict.notice).toMatch(/without a list does not cover a repair/);
      expect(verdict.notice).toContain("--accept-data-loss=dc_posts.meta");
    }
  });

  it("a consent naming only the table does not cover it, and says to name the column", () => {
    const verdict = consentForColumn(flag("dc_posts"), "dc_posts", "meta");
    expect(verdict.covered).toBe(false);
    expect(verdict.notice).toMatch(/names the table dc_posts, not the column/);
    expect(verdict.notice).toContain("--accept-data-loss=dc_posts.meta");
  });
});
