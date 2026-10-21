/**
 * The names a release gives the collections of documents a reader may not
 * read are decoration over counts that already carry each slug: a lookup that
 * fails leaves the slugs and is reported, and never fails the read.
 */
import { describe, expect, it, vi } from "vitest";

import { ReleasesService } from "../services/releases-service";
import type { ReleasesServiceDeps } from "../services/releases-service";
import { READY_CHECKS } from "./helpers/ready-checks";

const READER = { userId: "reader", overrideAccess: false };

function member(id: string, scopeSlug: string) {
  return {
    id,
    releaseId: "r1",
    scopeKind: "collection" as const,
    scopeSlug,
    entryId: `e-${id}`,
    locale: null,
    action: "publish" as const,
    memberKey: `collection:${scopeSlug}:e-${id}:`,
    singleSlot: null,
    createdBy: "author",
    createdAt: new Date("2026-10-20T09:00:00Z"),
  };
}

function service(scopeLabels: ReleasesServiceDeps["scopeLabels"]) {
  const repository = {
    findReleases: vi.fn(async () => [
      {
        id: "r1",
        title: "Launch",
        description: null,
        scheduledAt: null,
        timezone: null,
        state: "draft",
        publishedAt: null,
        createdBy: "author",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]),
    listMembers: vi.fn(async () => [
      member("m1", "posts"),
      member("m2", "secrets"),
    ]),
  };
  const logger = { warn: vi.fn() };
  const svc = new ReleasesService({
    repository: repository as unknown as ReleasesServiceDeps["repository"],
    canManageReleases: vi.fn(async () => true),
    canActOnDocument: vi.fn(async () => true),
    runDrainNow: vi.fn(async () => undefined),
    // The reader may read the post and not the secret.
    readableMembers: async () => new Set(["m1"]),
    scopeLabels,
    checks: READY_CHECKS,
    targets: {
      readDocument: async (target: { entryId: string }) => ({
        id: target.entryId,
      }),
      declaresLifecycle: async () => true,
    },
    logger,
  });
  return { svc, logger };
}

describe("the names of a reader's hidden documents' collections", () => {
  it("are given beside the count when they can be looked up, which is the control", async () => {
    const { svc } = service(
      async () =>
        new Map([
          [
            "collection\u0000secrets",
            { singular: "Secret", plural: "Secrets" },
          ],
        ])
    );
    const view = await svc.membersOf("r1", READER);
    expect(view.items.map(m => m.id)).toEqual(["m1"]);
    expect(view.hidden).toEqual([
      {
        scopeKind: "collection",
        scopeSlug: "secrets",
        count: 1,
        labels: { singular: "Secret", plural: "Secrets" },
      },
    ]);
  });

  it("leave the slug, and the read still answers, when the lookup fails", async () => {
    const { svc, logger } = service(async () => {
      throw new Error("registry unavailable");
    });
    const view = await svc.membersOf("r1", READER);
    expect(view.items.map(m => m.id)).toEqual(["m1"]);
    expect(view.hidden).toEqual([
      { scopeKind: "collection", scopeSlug: "secrets", count: 1 },
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
