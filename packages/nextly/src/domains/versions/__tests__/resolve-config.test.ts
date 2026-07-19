import { describe, it, expect } from "vitest";

import {
  DEFAULT_AUTOSAVE_INTERVAL_MS,
  DEFAULT_MAX_PER_DOC,
  resolveVersionsConfig,
} from "../resolve-config";

describe("resolveVersionsConfig", () => {
  it("returns null when unversioned (undefined / false)", () => {
    expect(resolveVersionsConfig(undefined)).toBeNull();
    expect(resolveVersionsConfig(false)).toBeNull();
    expect(resolveVersionsConfig(undefined, false)).toBeNull();
  });

  it("versions:true enables drafts + autosave with default maxPerDoc", () => {
    expect(resolveVersionsConfig(true)).toEqual({
      enabled: true,
      drafts: {
        enabled: true,
        autosave: { enabled: true, intervalMs: DEFAULT_AUTOSAVE_INTERVAL_MS },
        schedulePublish: false,
      },
      maxPerDoc: DEFAULT_MAX_PER_DOC,
    });
  });

  it("versions:{} defaults to the same as versions:true", () => {
    expect(resolveVersionsConfig({})).toEqual(resolveVersionsConfig(true));
  });

  it("versions:{drafts:false} is history-only (no drafts, no autosave)", () => {
    const resolved = resolveVersionsConfig({ drafts: false });
    expect(resolved?.enabled).toBe(true);
    expect(resolved?.drafts.enabled).toBe(false);
    expect(resolved?.drafts.autosave.enabled).toBe(false);
  });

  it("versions:{drafts:{autosave:false}} keeps drafts but disables autosave", () => {
    const resolved = resolveVersionsConfig({ drafts: { autosave: false } });
    expect(resolved?.drafts.enabled).toBe(true);
    expect(resolved?.drafts.autosave.enabled).toBe(false);
  });

  it("honors a custom autosave interval and schedulePublish", () => {
    const resolved = resolveVersionsConfig({
      drafts: { autosave: { intervalMs: 3000 }, schedulePublish: true },
    });
    expect(resolved?.drafts.autosave).toEqual({
      enabled: true,
      intervalMs: 3000,
    });
    expect(resolved?.drafts.schedulePublish).toBe(true);
  });

  it("honors maxPerDoc (number and unlimited)", () => {
    expect(resolveVersionsConfig({ maxPerDoc: 10 })?.maxPerDoc).toBe(10);
    expect(resolveVersionsConfig({ maxPerDoc: false })?.maxPerDoc).toBe(false);
  });

  it("status:true alone aliases to versions:{drafts:true}", () => {
    expect(resolveVersionsConfig(undefined, true)).toEqual(
      resolveVersionsConfig({ drafts: true })
    );
  });

  it("an explicit versions option wins over status", () => {
    // status would enable, but versions:false disables.
    expect(resolveVersionsConfig(false, true)).toBeNull();
    // versions:{drafts:false} (history-only) wins over status:true (drafts).
    expect(resolveVersionsConfig({ drafts: false }, true)?.drafts.enabled).toBe(
      false
    );
  });
});
