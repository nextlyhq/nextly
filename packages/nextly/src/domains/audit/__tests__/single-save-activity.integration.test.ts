/**
 * Each save of a Single writes one row to the activity trail, in the save's
 * transaction, on every dialect and on every install: these run with no
 * webhook endpoint and audit off, where the outbox records nothing, because
 * that is most installs and the trail has to hold there too.
 *
 * What counts as a save: an ordinary save, a held draft edit, a publish (one
 * row however many languages it moves), and publishing every language. An
 * autosave is a recovery point, not a save, and a write that names no actor
 * has no one to record.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import { container } from "../../../di/container";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ActivityLogService } from "../../../services/dashboard/activity-log-service";
import {
  refreshEndpointPresence,
  resetWebhookActivation,
  setWebhookAuditEnabled,
} from "../../webhooks/recording-activation";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  // A process-global the harness does not clear; reset so this file's audit
  // and presence state never reaches the next file in the sequential run.
  resetWebhookActivation();
});

/** An `activity_log` row as read back (Drizzle camelCases the columns). */
interface ActivityRow {
  actorType: string | null;
  userId: string;
  action: string;
  collection: string;
  entryId: string | null;
  entryTitle: string | null;
  locale: string | null;
  subjectKind: string | null;
}

const ANA = { id: "user-ana", name: "Ana", email: "ana@x.test", role: "admin" };
const AS_ANA = { overrideAccess: true, user: ANA };

async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: "site-settings",
        label: { singular: "Site Settings" },
        fields: [text({ name: "siteName" })],
      }),
      defineSingle({
        slug: "quiet",
        label: { singular: "Quiet" },
        // Opted out of the outbox entirely: the trail is not the outbox.
        webhooks: false,
        fields: [text({ name: "note" })],
      }),
      defineSingle({
        slug: "masthead",
        label: { singular: "Masthead" },
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [text({ name: "heading" })],
      }),
      defineSingle({
        slug: "banner",
        label: { singular: "Banner" },
        localized: true,
        status: true,
        versions: true,
        fields: [text({ name: "headline", localized: true })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  // The harness turns audit on so outbox tests do not depend on endpoints;
  // these are about the install where neither is on.
  setWebhookAuditEnabled(false);
  await refreshEndpointPresence();
  const now = new Date();
  await current.adapter.insert("users", {
    id: ANA.id,
    email: ANA.email,
    name: ANA.name,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const handle = current;
  return {
    singles: handle.getService("singleEntryService"),
    rowsOf: async (slug: string) =>
      (await handle.adapter.select<ActivityRow>("activity_log")).filter(
        row => row.collection === slug
      ),
    outboxCount: async () =>
      (await handle.adapter.select<{ id: string }>("nextly_events")).length,
  };
}

describe.each(getConfiguredTestDialects())(
  "a Single's saves in the activity trail (integration, %s)",
  dialect => {
    it("records the save that creates it, stating the Single, its live id and its label, with nothing in the outbox", async () => {
      const t = await boot(dialect);
      const saved = await t.singles.update(
        "site-settings",
        { siteName: "Acme" },
        AS_ANA
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);

      expect(await t.rowsOf("site-settings")).toEqual([
        expect.objectContaining({
          actorType: "user",
          userId: ANA.id,
          action: "update",
          subjectKind: "single",
          entryId: (saved.data as { id: string }).id,
          entryTitle: "Site Settings",
        }),
      ]);
      // The control for "on every install": the outbox's gate is closed here,
      // so the row above was not written through it.
      expect(await t.outboxCount()).toBe(0);
    }, 120_000);

    it("records a Single that opted out of webhooks", async () => {
      const t = await boot(dialect);
      await t.singles.update("quiet", { note: "x" }, AS_ANA);
      expect(await t.rowsOf("quiet")).toHaveLength(1);
    }, 120_000);

    it("records one row per save, without folding consecutive saves together", async () => {
      const t = await boot(dialect);
      for (const siteName of ["a", "b", "c"]) {
        await t.singles.update("site-settings", { siteName }, AS_ANA);
      }
      expect(await t.rowsOf("site-settings")).toHaveLength(3);
    }, 120_000);

    it("records a held draft edit as an update", async () => {
      const t = await boot(dialect);
      // Published by no one the trail records, so only the edit below counts.
      await t.singles.update(
        "masthead",
        { heading: "Live", status: "published" },
        { overrideAccess: true }
      );
      const held = await t.singles.update(
        "masthead",
        { heading: "Next" },
        { routeAuthorized: true, user: ANA }
      );
      expect(held.success, JSON.stringify(held)).toBe(true);

      expect(await t.rowsOf("masthead")).toEqual([
        expect.objectContaining({
          action: "update",
          subjectKind: "single",
          userId: ANA.id,
        }),
      ]);
    }, 120_000);

    it("records a publish of every language as one row, and publishing every language as one", async () => {
      const t = await boot(dialect);
      await t.singles.update(
        "banner",
        { headline: "hello" },
        {
          ...AS_ANA,
          locale: "en",
        }
      );
      await t.singles.update(
        "banner",
        { headline: "hola" },
        {
          ...AS_ANA,
          locale: "es",
        }
      );
      expect(await t.rowsOf("banner")).toHaveLength(2);

      await t.singles.update(
        "banner",
        { status: "published" },
        {
          ...AS_ANA,
          locale: "*",
        }
      );
      expect(await t.rowsOf("banner")).toHaveLength(3);

      await t.singles.update(
        "banner",
        { status: "draft" },
        {
          ...AS_ANA,
          locale: "*",
        }
      );
      expect(await t.rowsOf("banner")).toHaveLength(4);
      await t.singles.publishAllLocales("banner", AS_ANA);
      // One row for every language at once, not one per language.
      expect(await t.rowsOf("banner")).toHaveLength(5);
    }, 120_000);

    it("records nothing for an autosave", async () => {
      const t = await boot(dialect);
      const saved = await t.singles.update(
        "site-settings",
        { siteName: "Acme" },
        AS_ANA
      );
      const versions = current!.getService("versionsService");
      await versions.autosave({
        ref: {
          scopeKind: "single",
          scopeSlug: "site-settings",
          entryId: (saved.data as { id: string }).id,
        },
        status: "draft",
        snapshot: { siteName: "Acme, typing" },
        createdBy: ANA.id,
      });
      // The save above, and nothing for the recovery point.
      expect(await t.rowsOf("site-settings")).toHaveLength(1);
    }, 120_000);

    it("records nothing for a write that names no actor, and a key by its kind", async () => {
      const t = await boot(dialect);
      await t.singles.update(
        "site-settings",
        { siteName: "by the system" },
        { overrideAccess: true }
      );
      expect(await t.rowsOf("site-settings")).toEqual([]);

      await t.singles.update(
        "site-settings",
        { siteName: "by a key" },
        { overrideAccess: true, actor: { type: "apiKey", id: "key-1" } }
      );
      expect(await t.rowsOf("site-settings")).toEqual([
        expect.objectContaining({ actorType: "apiKey", subjectKind: "single" }),
      ]);
    }, 120_000);

    it("takes the save down with it when the row cannot be written", async () => {
      const t = await boot(dialect);
      await t.singles.update(
        "site-settings",
        { siteName: "Before" },
        {
          overrideAccess: true,
        }
      );
      const service = container.get<ActivityLogService>("activityLogService");
      service.logActivityInTx = () =>
        Promise.reject(new Error("activity trail unavailable"));

      const result = await t.singles.update(
        "site-settings",
        { siteName: "After" },
        AS_ANA
      );
      expect(result.success).toBe(false);

      // Both halves: the save is refused, and the content is as it was, so
      // the two were one transaction rather than two failing together.
      const read = await t.singles.get("site-settings", {
        overrideAccess: true,
      });
      expect((read.data as { siteName?: string }).siteName).toBe("Before");
      expect(await t.rowsOf("site-settings")).toEqual([]);
    }, 120_000);
  }
);
