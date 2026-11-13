/**
 * The start records the stored schema version its definitions were loaded at
 * (`definitionsLoaded`), so the first follow of the version does not load them
 * all again. Two rules keep that record honest, both properties of the order
 * and the condition in `registerServices`, read here from its source:
 *
 * - **The label is read before the rows it labels.** A production start reads
 *   the registries once, early (`beginStartReads`), and answers the loads from
 *   that reading. A version read after it could name a change the rows do not
 *   hold, and the stale definitions would then never be loaded again.
 * - **Only a complete load is recorded.** One that left a definition
 *   unregistered is left for the first follow to load again.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const registerText = readFileSync(
  fileURLToPath(new URL("../register.ts", import.meta.url)),
  "utf8"
);

/** `text`'s offset in `register.ts`, required to be there. */
function at(text: string): number {
  const offset = registerText.indexOf(text);
  expect(offset, text).toBeGreaterThan(-1);
  return offset;
}

describe("the start's record of the schema version it loaded at", () => {
  it("reads the version before the start's shared registry reads begin", () => {
    expect(at("await versionBeforeLoading(adapter)")).toBeLessThan(
      at("if (structure.productionStart) beginStartReads(adapter)")
    );
  });

  it("records it after the definitions load, and only for a complete load", () => {
    const load = at("const registry = await initializeSchemaRegistry(");
    const condition = at(
      "if (registry !== undefined && completeness.complete) {"
    );
    const record = at("definitionsLoaded(adapter, definitionsVersion)");
    expect(load).toBeLessThan(condition);
    expect(condition).toBeLessThan(record);
    // The record is the condition's own statement, nothing between them.
    expect(registerText.slice(condition, record).replace(/\s+/g, " ")).toBe(
      "if (registry !== undefined && completeness.complete) { "
    );
  });
});
