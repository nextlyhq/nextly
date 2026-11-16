/**
 * What a published page may show of the site's general settings: the
 * allowlisted settings, and nothing else the settings row holds; and which
 * instance they are read from.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GeneralSettingsRecord } from "../../schemas/site-settings/types";
import {
  publicSiteSettingsOf,
  readPublicSiteSettings,
  type PublicSiteSettingsSource,
} from "../site-settings-read";

// The process's registered instance, faked: what the boot hands back, and how
// often it was asked for. Mocked at the module the read imports inside its
// call, so a read that reaches for the process instance is counted here.
const processInstance = vi.hoisted(() => ({
  boots: 0,
  answer: null as Record<string, unknown> | null,
}));
vi.mock("../../init", () => ({
  getCachedNextly: async () => {
    processInstance.boots += 1;
    return {
      publicSiteSettings: async () => {
        if (processInstance.answer === null) {
          throw new Error("no instance registered");
        }
        return processInstance.answer;
      },
    };
  },
}));

beforeEach(() => {
  processInstance.boots = 0;
  processInstance.answer = null;
});

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

describe("readPublicSiteSettings", () => {
  /** An instance answering with its whole settings record, private ones included. */
  function instanceOf(
    overrides: Partial<GeneralSettingsRecord>
  ): PublicSiteSettingsSource & { calls: () => number } {
    let calls = 0;
    return {
      publicSiteSettings: async () => {
        calls += 1;
        return { ...record, ...overrides };
      },
      calls: () => calls,
    };
  }

  it("reads the instance it is given, and never the process's", async () => {
    // The control: the process has an instance, with a site of its own, so a
    // read that reached for it would answer with that site rather than fail.
    processInstance.answer = { ...record, applicationName: "Process site" };
    const acme = instanceOf({
      applicationName: "Acme",
      timezone: "Europe/Paris",
    });
    const globex = instanceOf({
      applicationName: "Globex",
      timezone: "America/New_York",
    });

    await expect(readPublicSiteSettings(acme)).resolves.toMatchObject({
      applicationName: "Acme",
      timezone: "Europe/Paris",
    });
    await expect(readPublicSiteSettings(globex)).resolves.toMatchObject({
      applicationName: "Globex",
      timezone: "America/New_York",
    });
    expect(acme.calls()).toBe(1);
    expect(globex.calls()).toBe(1);
    expect(processInstance.boots).toBe(0);
  });

  it("holds an instance's answer to the allowlist, whatever else it carries", async () => {
    const settings = await readPublicSiteSettings(
      instanceOf({ applicationName: "Acme" })
    );
    expect(Object.keys(settings).sort()).toEqual([
      "applicationName",
      "logoUrl",
      "siteUrl",
      "timezone",
    ]);
    expect(JSON.stringify(settings)).not.toContain("owner@acme.test");
    expect(Object.isFrozen(settings)).toBe(true);
  });

  it("given no instance, reads the process's registered one, as before", async () => {
    processInstance.answer = { ...record, applicationName: "Process site" };
    const settings = await readPublicSiteSettings();
    expect(settings).toEqual({
      applicationName: "Process site",
      siteUrl: "https://acme.test",
      logoUrl: "https://acme.test/logo.png",
      timezone: "Asia/Karachi",
    });
    expect(JSON.stringify(settings)).not.toContain("owner@acme.test");
    expect(processInstance.boots).toBe(1);
  });

  it("given no instance, rejects when the process's instance cannot answer, as before", async () => {
    await expect(readPublicSiteSettings()).rejects.toThrow(
      "no instance registered"
    );
    expect(processInstance.boots).toBe(1);
  });
});
