/**
 * The singleton guard's exemptions stay exactly as wide as their names.
 *
 * `shared-module-guards.ts` fails a file that changes a `__nextly*` singleton,
 * except the loaded-dialect cache and the role version every permission check
 * refreshes, which it restores without failing. Those exemptions are safe only
 * for them, so a change to any other singleton, including one whose name
 * merely starts the same way, must still fail.
 */

import { describe, expect, it } from "vitest";

import {
  RESTORED_QUIETLY,
  failingSingletons,
} from "./shared-module-guards-policy";

const changed = (key: string, label = key) => ({ key, label });

describe("which changed singletons fail a file", () => {
  it("exempts exactly the loaded-dialect cache and the role version", () => {
    expect([...RESTORED_QUIETLY]).toEqual([
      "__nextly_dialectTables",
      "__nextly_rbacEpoch",
    ]);
  });

  it("does not fail a file for loading another dialect", () => {
    expect(failingSingletons([changed("__nextly_dialectTables")])).toEqual([]);
  });

  it("does not fail a file for refreshing the role version", () => {
    expect(
      failingSingletons([
        changed("__nextly_rbacEpoch"),
        changed("readAt", "__nextly_rbacEpoch.readAt"),
      ])
    ).toEqual([]);
  });

  it("still fails a file for any other singleton it changed", () => {
    expect(
      failingSingletons([
        changed("__nextly_dialectTables"),
        changed("__nextly_isRegistered"),
        changed("__nextly_hookRegistry", "__nextly_hookRegistry.hooks"),
      ])
    ).toEqual(["__nextly_isRegistered", "__nextly_hookRegistry.hooks"]);
  });

  it("matches the exemption by whole name, not by prefix", () => {
    expect(
      failingSingletons([
        changed("__nextly_dialectTablesBackup"),
        changed("__nextly_dialect"),
        changed("__nextly_rbacEpochBackup"),
        changed("readAt", "__nextly_rbacEpochBackup.readAt"),
      ])
    ).toEqual([
      "__nextly_dialectTablesBackup",
      "__nextly_dialect",
      "__nextly_rbacEpochBackup",
      "__nextly_rbacEpochBackup.readAt",
    ]);
  });
});
