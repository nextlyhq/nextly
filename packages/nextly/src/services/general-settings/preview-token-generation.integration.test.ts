/**
 * The preview-link revocation generation, against a real database.
 *
 * Revocation for preview links is a counter rather than a per-token denylist:
 * every token records the generation it was minted under, and verification
 * refuses any token whose generation is not the current one. That buys
 * `revoke-all` with nothing to store, sweep or replicate — but it puts the
 * whole mechanism on one integer, so what matters is that the integer can only
 * move forward and can never lose an increment.
 *
 * These run on a real database because both properties are the database's:
 * whether concurrent updates serialize, and whether a row written before the
 * column existed reads back as a usable generation.
 */
import { createTestNextly, type TestNextly } from "nextly/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GeneralSettingsService } from "./general-settings-service";

let harness: TestNextly | undefined;

function service(): GeneralSettingsService {
  return new GeneralSettingsService(harness!.adapter, {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  });
}

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

beforeEach(async () => {
  harness = await createTestNextly();
});

describe("preview token revocation generation (integration)", () => {
  it("starts at zero on an installation that has never revoked", async () => {
    // Tokens minted before any revoke carry generation 0, so the default has to
    // BE 0 — a column defaulting to anything else would refuse every link that
    // was already in circulation the moment it was added.
    expect(await service().getPreviewTokenGeneration()).toBe(0);
  });

  it("creates the singleton row when revoking before any settings were saved", async () => {
    // An installation that has never opened the settings form still has to be
    // able to revoke. Generation 1 correctly refuses tokens minted at the
    // implicit 0.
    const settings = service();

    expect(await settings.revokeAllPreviewTokens()).toBe(1);
    expect(await settings.getPreviewTokenGeneration()).toBe(1);
  });

  it("keeps counting from an existing settings row", async () => {
    const settings = service();
    await settings.updateSettings({ applicationName: "Preview" });

    expect(await settings.revokeAllPreviewTokens()).toBe(1);
    expect(await settings.revokeAllPreviewTokens()).toBe(2);

    // The revoke must not disturb the rest of the row: it shares a table with
    // ordinary settings and writes through the same update.
    const record = await settings.getSettings();
    expect(record.applicationName).toBe("Preview");
    expect(record.previewTokenGeneration).toBe(2);
  });

  it("loses no increment when revokes run concurrently", async () => {
    // The increment is computed by the DATABASE (`generation + 1`) rather than
    // read-then-written, so two administrators revoking at once cannot both
    // compute the same next value and leave one of the two revocations undone.
    // Read-modify-write would settle on 1 here.
    const settings = service();
    await settings.revokeAllPreviewTokens();

    await Promise.all([
      settings.revokeAllPreviewTokens(),
      settings.revokeAllPreviewTokens(),
      settings.revokeAllPreviewTokens(),
    ]);

    expect(await settings.getPreviewTokenGeneration()).toBe(4);
  });

  it("does not expose the generation to the settings form", async () => {
    // `GeneralSettingsUpdate` omits the field, so this cannot be written in
    // typed code — but `updateSettings` takes a partial and the admin API
    // forwards a parsed body, so the runtime allow-list is what actually holds
    // the line. Lowering the generation would re-validate every link a revoke
    // had already invalidated.
    const settings = service();
    await settings.revokeAllPreviewTokens();
    await settings.revokeAllPreviewTokens();

    await settings.updateSettings({
      applicationName: "Still fine",
      ...({ previewTokenGeneration: 0 } as Partial<
        Parameters<GeneralSettingsService["updateSettings"]>[0]
      >),
    });

    expect(await settings.getPreviewTokenGeneration()).toBe(2);
  });
});
