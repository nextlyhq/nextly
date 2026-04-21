/**
 * Unit tests for reconcileSingleTables.
 *
 * The reconciler is the startup safety net that makes "registered" imply
 * "table exists on disk" hold true across dev restarts. These tests lock
 * in the contract: create missing tables, skip existing tables, no-op on
 * empty registry, propagate DDL errors.
 */

import { describe, it, expect, vi } from "vitest";

import {
  reconcileSingleTables,
  type RegisteredSingle,
  type SingleTableReconciler,
} from "./reconcile-single-tables";

function makeReconciler(
  registered: RegisteredSingle[],
  existing: string[],
  createTable: (single: RegisteredSingle) => Promise<void> = async () => {}
): SingleTableReconciler {
  return {
    registeredSingles: async () => registered,
    existingTableNames: async () => new Set(existing),
    createTable,
  };
}

describe("reconcileSingleTables", () => {
  it("creates missing tables for singles that exist in the registry but not in the DB", async () => {
    const create = vi.fn(async () => {});
    const reconciler = makeReconciler(
      [{ slug: "site-settings", tableName: "single_site_settings" }],
      [],
      create
    );
    await reconcileSingleTables(reconciler);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      slug: "site-settings",
      tableName: "single_site_settings",
    });
  });

  it("skips singles whose tables already exist", async () => {
    const create = vi.fn(async () => {});
    const reconciler = makeReconciler(
      [{ slug: "site-settings", tableName: "single_site_settings" }],
      ["single_site_settings"],
      create
    );
    await reconcileSingleTables(reconciler);
    expect(create).not.toHaveBeenCalled();
  });

  it("is a no-op when the registry is empty", async () => {
    const create = vi.fn(async () => {});
    const reconciler = makeReconciler([], [], create);
    await reconcileSingleTables(reconciler);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates every missing table when multiple singles are registered", async () => {
    const create = vi.fn(async () => {});
    const reconciler = makeReconciler(
      [
        { slug: "site-settings", tableName: "single_site_settings" },
        { slug: "navigation", tableName: "single_navigation" },
        { slug: "homepage", tableName: "single_homepage" },
      ],
      ["single_navigation"],
      create
    );
    await reconcileSingleTables(reconciler);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledWith({
      slug: "site-settings",
      tableName: "single_site_settings",
    });
    expect(create).toHaveBeenCalledWith({
      slug: "homepage",
      tableName: "single_homepage",
    });
  });

  it("propagates errors from createTable", async () => {
    const reconciler = makeReconciler(
      [{ slug: "x", tableName: "single_x" }],
      [],
      async () => {
        throw new Error("ddl failed");
      }
    );
    await expect(reconcileSingleTables(reconciler)).rejects.toThrow(
      "ddl failed"
    );
  });

  it("does not query createTable for singles that exist and does create for those that do not, in the same run", async () => {
    const create = vi.fn(async () => {});
    const reconciler = makeReconciler(
      [
        { slug: "a", tableName: "single_a" },
        { slug: "b", tableName: "single_b" },
      ],
      ["single_a"],
      create
    );
    await reconcileSingleTables(reconciler);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      slug: "b",
      tableName: "single_b",
    });
  });
});
