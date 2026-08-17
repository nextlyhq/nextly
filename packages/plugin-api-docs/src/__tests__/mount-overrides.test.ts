/**
 * Tests for the mount-override merge. Pure: a synthetic scan result, so the
 * replace/add/dedup semantics are pinned without touching the filesystem.
 *
 * @module __tests__/mount-overrides
 * @since alpha
 */
import { describe, expect, it } from "vitest";

import { applyMountOverrides } from "../mount-overrides";

import type { ScanResult } from "../scan";

const scan = (): ScanResult => ({
  routes: [
    {
      filePath: "/app/admin/api/[[...params]]/route.ts",
      mountPath: "/admin/api/[[...params]]",
      source: { kind: "dynamic-catchall" },
      verbs: ["GET", "POST", "PATCH", "DELETE"],
    },
    {
      filePath: "/app/api/health/route.ts",
      mountPath: "/api/health",
      source: { kind: "api-subpath", subpath: "health" },
      verbs: ["GET", "HEAD"],
    },
  ],
  unrecognized: [],
});

describe("applyMountOverrides", () => {
  it("returns the scan unchanged when no overrides are given", () => {
    expect(applyMountOverrides(scan())).toEqual(scan());
    expect(applyMountOverrides(scan(), [])).toEqual(scan());
  });

  it("replaces a scanned mount's source and verbs, keeping its filePath", () => {
    const result = applyMountOverrides(scan(), [
      {
        mountPath: "/api/health",
        source: { kind: "api-subpath", subpath: "health" },
        verbs: ["GET"],
      },
    ]);
    const health = result.routes.find(r => r.mountPath === "/api/health");
    expect(health?.verbs).toEqual(["GET"]);
    // The override corrected the verbs but the mount still traces to its file.
    expect(health?.filePath).toBe("/app/api/health/route.ts");
    expect(result.routes).toHaveLength(2);
  });

  it("adds an override whose mountPath the scan did not find", () => {
    const result = applyMountOverrides(scan(), [
      {
        mountPath: "/api/custom-webhook",
        source: { kind: "api-subpath", subpath: "email-send" },
        verbs: ["POST"],
      },
    ]);
    const added = result.routes.find(
      r => r.mountPath === "/api/custom-webhook"
    );
    expect(added?.source).toEqual({
      kind: "api-subpath",
      subpath: "email-send",
    });
    // A declared-only mount has no source file.
    expect(added?.filePath).toBeUndefined();
    expect(result.routes).toHaveLength(3);
  });

  it("lets the last duplicate override path win (deterministic)", () => {
    const result = applyMountOverrides(scan(), [
      {
        mountPath: "/api/health",
        source: { kind: "api-subpath", subpath: "health" },
        verbs: ["GET"],
      },
      {
        mountPath: "/api/health",
        source: { kind: "api-subpath", subpath: "health" },
        verbs: ["HEAD"],
      },
    ]);
    const health = result.routes.find(r => r.mountPath === "/api/health");
    expect(health?.verbs).toEqual(["HEAD"]);
    expect(
      result.routes.filter(r => r.mountPath === "/api/health")
    ).toHaveLength(1);
  });

  it("passes the unrecognized list through untouched", () => {
    const withUnrecognized: ScanResult = {
      ...scan(),
      unrecognized: [{ filePath: "app/api/odd/route.ts", reason: "unknown" }],
    };
    const result = applyMountOverrides(withUnrecognized, [
      {
        mountPath: "/api/new",
        source: { kind: "api-subpath", subpath: "health" },
        verbs: ["GET"],
      },
    ]);
    expect(result.unrecognized).toEqual(withUnrecognized.unrecognized);
  });
});
