import { describe, expect, it } from "vitest";

import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import { MIGRATION_TARGET } from "../manifest";
import { rewriteConfigPath } from "../rewrite-config-path";

const FROM = STORAGE_FORMAT.configPathDir;
const TO = MIGRATION_TARGET.configPathDir;

function up(value: unknown): unknown {
  return rewriteConfigPath(value, FROM, TO);
}

describe("rewriting a registry row's config path", () => {
  it("swaps the leading directory segment", () => {
    expect(up("components/hero.ts")).toBe("field-groups/hero.ts");
  });

  // 🔴 The reason this is anchored rather than a substring replace: a project
  // directory whose name merely ends in the segment is not that segment.
  it("leaves a directory that only ends with the segment alone", () => {
    expect(up("my-components/hero.ts")).toBe("my-components/hero.ts");
    expect(up("ui-components/hero.ts")).toBe("ui-components/hero.ts");
  });

  // Anchored to the start too, so the same word deeper in a path is content.
  it("leaves the segment alone when it is not the leading one", () => {
    expect(up("src/components/hero.ts")).toBe("src/components/hero.ts");
  });

  // The separator is required, or a sibling directory sharing the prefix would
  // be rewritten into a path that does not exist.
  it("requires a separator, not just the prefix", () => {
    expect(up("components-legacy/hero.ts")).toBe("components-legacy/hero.ts");
    expect(up("components")).toBe("components");
  });

  it("is idempotent", () => {
    expect(up(up("components/hero.ts"))).toBe("field-groups/hero.ts");
  });

  it("reverses when the arguments are swapped", () => {
    const migrated = up("components/hero.ts");
    expect(rewriteConfigPath(migrated, TO, FROM)).toBe("components/hero.ts");
  });

  it("passes through anything that is not a string", () => {
    expect(up(null)).toBeNull();
    expect(up(undefined)).toBeUndefined();
    expect(up(7)).toBe(7);
  });
});
