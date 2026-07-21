import { describe, it, expect, vi, beforeEach } from "vitest";

const saveMigration = vi.fn();
let handler:
  | { getFileManager: () => { saveMigration: typeof saveMigration } }
  | undefined;

vi.mock("../di", () => ({
  getCollectionsHandlerFromDI: () => handler,
}));

import { writeBuilderMigration } from "../write-builder-migration";

beforeEach(() => {
  saveMigration.mockReset();
  handler = { getFileManager: () => ({ saveMigration }) };
});

describe("writeBuilderMigration", () => {
  it("writes the executed DDL as an update migration", async () => {
    await writeBuilderMigration("collection", "widget", [
      'ALTER TABLE "dc_widget" ADD COLUMN "headline" text;',
      'ALTER TABLE "dc_widget" ADD COLUMN "rating" integer;',
    ]);

    expect(saveMigration).toHaveBeenCalledTimes(1);
    const [sql, fileName] = saveMigration.mock.calls[0];

    // Both statements are persisted, separated by the drizzle breakpoint
    // marker the create-migrations already use.
    expect(sql).toContain('ADD COLUMN "headline"');
    expect(sql).toContain('ADD COLUMN "rating"');
    expect(sql).toContain("--> statement-breakpoint");
    expect(sql).toContain("-- Update dynamic collection: widget");
    expect(fileName).toMatch(/^\d+_update_widget\.sql$/);
  });

  it("normalizes a slug that isn't filename-safe", async () => {
    await writeBuilderMigration("collection", "My Widget!", [
      'ALTER TABLE "x" ADD COLUMN "y" text;',
    ]);

    const [, fileName] = saveMigration.mock.calls[0];
    expect(fileName).toMatch(/^\d+_update_my_widget_\.sql$/);
  });

  it("writes nothing when no statements were executed", async () => {
    await writeBuilderMigration("collection", "widget", []);
    await writeBuilderMigration("collection", "widget", undefined);
    expect(saveMigration).not.toHaveBeenCalled();
  });

  it("does not throw when the collections handler is unavailable", async () => {
    handler = undefined;
    await expect(
      writeBuilderMigration("collection", "widget", [
        'ALTER TABLE "x" ADD COLUMN "y" text;',
      ])
    ).resolves.toBeUndefined();
  });

  it("swallows a write failure because the DDL already ran", async () => {
    saveMigration.mockRejectedValueOnce(
      new Error("EROFS: read-only file system")
    );
    await expect(
      writeBuilderMigration("collection", "widget", [
        'ALTER TABLE "x" ADD COLUMN "y" text;',
      ])
    ).resolves.toBeUndefined();
  });

  it("labels the migration with the entity kind for singles and components", async () => {
    await writeBuilderMigration("single", "promo-banner", [
      'ALTER TABLE "single_promo_banner" ADD COLUMN "headline" text;',
    ]);
    expect(saveMigration.mock.calls[0][0]).toContain(
      "-- Update dynamic single: promo-banner"
    );

    saveMigration.mockReset();
    await writeBuilderMigration("component", "cta_block", [
      'ALTER TABLE "comp_cta_block" ADD COLUMN "button_text" text;',
    ]);
    expect(saveMigration.mock.calls[0][0]).toContain(
      "-- Update dynamic component: cta_block"
    );
  });
});
