/**
 * The one mapping every Builder write path uses for the version-history
 * switch. Its two decisions are easy to undo by reaching for the code-first
 * resolver directly, so both are pinned here.
 */
import { describe, expect, it } from "vitest";

import { resolveBuilderVersions } from "../builder-versions";

describe("resolveBuilderVersions", () => {
  it("resolves the switch to history only, without drafts", () => {
    // The control says it records saves so they can be restored, and that it
    // does not add drafts. `resolveVersionsConfig(true)` would turn drafts and
    // autosave on, making the help text untrue once drafts are enforced.
    const resolved = resolveBuilderVersions(true);

    expect(resolved?.enabled).toBe(true);
    expect(resolved?.drafts.enabled).toBe(false);
    expect(resolved?.drafts.autosave.enabled).toBe(false);
  });

  it("keeps the configured retention default", () => {
    expect(resolveBuilderVersions(true)?.maxPerDoc).toBe(50);
  });

  it("resolves off and absent to no config at all", () => {
    // Null is what the column holds for an unversioned entity; an object with
    // `enabled: false` would read as versioned to `versions?.enabled` checks.
    expect(resolveBuilderVersions(false)).toBeNull();
    expect(resolveBuilderVersions(undefined)).toBeNull();
  });
});
