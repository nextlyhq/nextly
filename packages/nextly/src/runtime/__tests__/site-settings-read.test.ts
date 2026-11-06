/**
 * What a published page may show of the site's general settings: the
 * allowlisted settings, and nothing else the settings row holds.
 */
import { describe, expect, it } from "vitest";

import type { GeneralSettingsRecord } from "../../schemas/site-settings/types";
import { publicSiteSettingsOf } from "../site-settings-read";

/** A row with every setting set, the private ones included. */
const record: GeneralSettingsRecord = {
  id: "default",
  applicationName: "Acme",
  siteUrl: "https://acme.test",
  adminEmail: "owner@acme.test",
  timezone: "Asia/Karachi",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  logoUrl: "https://acme.test/logo.png",
  customSidebarGroups: "[]",
  pluginPlacements: "{}",
  previewTokenGeneration: 4,
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("publicSiteSettingsOf", () => {
  it("shows the four public settings and nothing else", () => {
    expect(publicSiteSettingsOf(record)).toEqual({
      applicationName: "Acme",
      siteUrl: "https://acme.test",
      logoUrl: "https://acme.test/logo.png",
      timezone: "Asia/Karachi",
    });
  });

  it("never carries the administrator's email or the revocation counter", () => {
    const shown = JSON.stringify(publicSiteSettingsOf(record));
    expect(shown).not.toContain("owner@acme.test");
    expect(shown).not.toContain("previewTokenGeneration");
  });

  it("leaves out a column the settings row gains later", () => {
    const grown = { ...record, smtpPassword: "hunter2" };
    expect(Object.keys(publicSiteSettingsOf(grown)).sort()).toEqual([
      "applicationName",
      "logoUrl",
      "siteUrl",
      "timezone",
    ]);
  });

  it("answers null for a setting the site has not set", () => {
    expect(
      publicSiteSettingsOf({ ...record, timezone: null, siteUrl: null })
    ).toMatchObject({ timezone: null, siteUrl: null });
  });

  it("is frozen, so a page cannot change what the next one reads", () => {
    expect(Object.isFrozen(publicSiteSettingsOf(record))).toBe(true);
  });
});
