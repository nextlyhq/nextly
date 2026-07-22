/**
 * A Single's first write authorizes the publish transition BEFORE it persists
 * the auto-created default, so a refused first publish leaves no row behind.
 *
 * This pins the authorize-before-create contract on a real database: the earlier
 * design auto-created the default row up front and deleted it on denial, a
 * rollback that could destroy a concurrent writer's row. The default is now
 * inserted only once the write (including any publish) is authorized.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("single publish enforcement — authorize before create (integration)", () => {
  it("does not persist the default when a first publish is denied", async () => {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "settings",
          status: true,
          // The route attests `update`; only the publish transition can fail,
          // and this code-defined rule denies it.
          access: { publish: () => false },
          fields: [text({ name: "siteName" })],
        }),
      ],
    });
    const service =
      current.getService<SingleEntryService>("singleEntryService");

    // First-ever write, and it would publish. The publish rule denies it.
    const denied = await service.update(
      "settings",
      { siteName: "S", status: "published" },
      { user: { id: "u1" }, routeAuthorized: true }
    );

    expect(denied.success).toBe(false);
    expect(denied.statusCode).toBe(403);

    // The default was never inserted: the single's table is still empty.
    const row = await current.adapter.selectOne("single_settings", {});
    expect(row).toBeNull();
  });

  it("persists and publishes a first write when the publish is authorized", async () => {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "settings",
          status: true,
          access: { publish: () => false },
          fields: [text({ name: "siteName" })],
        }),
      ],
    });
    const service =
      current.getService<SingleEntryService>("singleEntryService");

    // A trusted (overrideAccess) first publish bypasses the gate — the mirror of
    // the denial case. It proves the deferred default is still persisted for an
    // authorized write, so the authorize-before-create change does not block a
    // legitimate first publish.
    const ok = await service.update(
      "settings",
      { siteName: "S", status: "published" },
      { overrideAccess: true }
    );

    expect(ok.success).toBe(true);

    // The deferred default was persisted and carries the published status.
    const row = await current.adapter.selectOne<{ status?: string }>(
      "single_settings",
      {}
    );
    expect(row).not.toBeNull();
    expect(row?.status).toBe("published");
  });

  it("still allows a first draft write without the publish permission", async () => {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "settings",
          status: true,
          access: { publish: () => false },
          fields: [text({ name: "siteName" })],
        }),
      ],
    });
    const service =
      current.getService<SingleEntryService>("singleEntryService");

    // A first write that stays a draft names no publish transition, so the
    // denying publish rule is never consulted and the row is created.
    const ok = await service.update(
      "settings",
      { siteName: "S", status: "draft" },
      { user: { id: "u1" }, routeAuthorized: true }
    );

    expect(ok.success).toBe(true);
    const row = await current.adapter.selectOne<{ status?: string }>(
      "single_settings",
      {}
    );
    expect(row).not.toBeNull();
    expect(row?.status).toBe("draft");
  });

  it("gates a default-locale companion publish when the main row is already published", async () => {
    // For a localized Single the default locale's status also lands on the
    // companion `_status`. When the main row is already published but the
    // default-locale companion `_status` diverged to draft (reachable after
    // per-locale status is added to existing content), a `?locale=<default>`
    // publish moves the companion into published and must still require the
    // publish permission — the gate cannot key on the main row alone.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "settings",
          localized: true,
          status: true,
          access: { publish: () => false },
          fields: [text({ name: "heading" })],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const service =
      current.getService<SingleEntryService>("singleEntryService");
    const adapter = current.adapter as unknown as {
      executeQuery: (sql: string) => Promise<unknown>;
    };

    // Trusted create publishes the default locale: main row published, companion
    // `en` `_status` published.
    await service.update(
      "settings",
      { heading: "H", status: "published" },
      { overrideAccess: true, locale: "en" }
    );
    const mainRow = await current.adapter.selectOne<{ id: string }>(
      "single_settings",
      {}
    );
    const id = mainRow?.id as string;

    // Manufacture the divergence: main stays published, companion `en` → draft.
    await adapter.executeQuery(
      `UPDATE "single_settings_locales" SET "_status" = 'draft' WHERE "_parent" = '${id}' AND "_locale" = 'en'`
    );

    // A caller with update (route-attested) but not publish re-publishes the
    // default locale. The companion draft -> published transition must be denied.
    const denied = await service.update(
      "settings",
      { heading: "H2", status: "published" },
      { user: { id: "u1" }, routeAuthorized: true, locale: "en" }
    );
    expect(denied.success).toBe(false);
    expect(denied.statusCode).toBe(403);

    // The companion `_status` was not moved to published.
    const rows = (await adapter.executeQuery(
      `SELECT "_status" FROM "single_settings_locales" WHERE "_parent" = '${id}' AND "_locale" = 'en'`
    )) as Array<{ _status: string }> | { rows?: Array<{ _status: string }> };
    const list = Array.isArray(rows) ? rows : (rows.rows ?? []);
    expect(list[0]?._status).toBe("draft");
  });
});
