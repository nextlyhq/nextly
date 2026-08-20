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

  it("honors a custom autosave interval", () => {
    const resolved = resolveVersionsConfig({
      drafts: { autosave: { intervalMs: 3000 } },
    });
    expect(resolved?.drafts.autosave).toEqual({
      enabled: true,
      intervalMs: 3000,
    });
  });

  it("honors maxPerDoc (number and unlimited)", () => {
    expect(resolveVersionsConfig({ maxPerDoc: 10 })?.maxPerDoc).toBe(10);
    expect(resolveVersionsConfig({ maxPerDoc: false })?.maxPerDoc).toBe(false);
  });

  it("status:true alone enables history-only versioning, not the working-draft split", () => {
    const resolved = resolveVersionsConfig(undefined, true);
    // Versioned (history is captured) but the draft/published split is OFF — the
    // split is opt-in via an explicit versions:{drafts:true}.
    expect(resolved?.enabled).toBe(true);
    expect(resolved?.drafts.enabled).toBe(false);
    expect(resolved).toEqual(resolveVersionsConfig({ drafts: false }));
  });

  it("an explicit versions option wins over status", () => {
    // status would enable, but versions:false disables.
    expect(resolveVersionsConfig(false, true)).toBeNull();
    // An explicit versions:{drafts:false} resolves to history-only regardless of
    // the status flag.
    expect(resolveVersionsConfig({ drafts: false }, true)?.drafts.enabled).toBe(
      false
    );
  });
});
