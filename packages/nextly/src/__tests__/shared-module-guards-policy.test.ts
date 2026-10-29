/**
 * The singleton guard's one exemption stays one name wide.
 *
 * `shared-module-guards.ts` fails a file that changes a `__nextly*` singleton,
 * except the loaded-dialect cache, which it restores without failing. That
 * exemption is safe only for that cache, so a change to any other singleton,
 * including one whose name merely starts the same way, must still fail.
 */

import { describe, expect, it } from "vitest";

import {
  RESTORED_QUIETLY,
  failingSingletons,
} from "./shared-module-guards-policy";

const changed = (key: string, label = key) => ({ key, label });

describe("which changed singletons fail a file", () => {
  it("exempts exactly the loaded-dialect cache", () => {
    expect([...RESTORED_QUIETLY]).toEqual(["__nextly_dialectTables"]);
  });

  it("does not fail a file for loading another dialect", () => {
    expect(failingSingletons([changed("__nextly_dialectTables")])).toEqual([]);
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
      ])
    ).toEqual(["__nextly_dialectTablesBackup", "__nextly_dialect"]);
  });
});
