/**
 * The one mapping every Builder write path uses for the version-history
 * switch. Its two decisions are easy to undo by reaching for the code-first
 * resolver directly, so both are pinned here.
 */
import { describe, expect, it } from "vitest";

import {
  coerceBuilderMaxPerDoc,
  resolveBuilderVersions,
} from "../builder-versions";

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

  it("keeps the configured retention default when none is given", () => {
    expect(resolveBuilderVersions(true)?.maxPerDoc).toBe(50);
  });

  it("carries an explicit retention count", () => {
    expect(resolveBuilderVersions(true, 10)?.maxPerDoc).toBe(10);
    // Zero is a real setting (keep only protected versions), distinct from the
    // default and from unlimited.
    expect(resolveBuilderVersions(true, 0)?.maxPerDoc).toBe(0);
  });

  it("carries unlimited retention", () => {
    expect(resolveBuilderVersions(true, false)?.maxPerDoc).toBe(false);
  });

  it("ignores retention when the switch is off", () => {
    expect(resolveBuilderVersions(false, 10)).toBeNull();
  });

  it("resolves off and absent to no config at all", () => {
    // Null is what the column holds for an unversioned entity; an object with
    // `enabled: false` would read as versioned to `versions?.enabled` checks.
    expect(resolveBuilderVersions(false)).toBeNull();
    expect(resolveBuilderVersions(undefined)).toBeNull();
  });
});

describe("coerceBuilderMaxPerDoc", () => {
  it("passes through a non-negative integer", () => {
    expect(coerceBuilderMaxPerDoc(0)).toBe(0);
    expect(coerceBuilderMaxPerDoc(25)).toBe(25);
  });

  it("passes through false as unlimited", () => {
    expect(coerceBuilderMaxPerDoc(false)).toBe(false);
  });

  it("treats absent or malformed values as the default", () => {
    // Undefined so the resolver applies the default (50) rather than rejecting.
    expect(coerceBuilderMaxPerDoc(undefined)).toBeUndefined();
    expect(coerceBuilderMaxPerDoc(null)).toBeUndefined();
    expect(coerceBuilderMaxPerDoc(-1)).toBeUndefined();
    expect(coerceBuilderMaxPerDoc(1.5)).toBeUndefined();
    expect(coerceBuilderMaxPerDoc("10")).toBeUndefined();
    expect(coerceBuilderMaxPerDoc(true)).toBeUndefined();
  });
});
