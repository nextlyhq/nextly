/**
 * A sync of the configuration's user fields writes only what differs from the
 * definitions stored, on every dialect: nothing when the configuration declares
 * the fields already stored (none included), and for one changed field that
 * field's row alone. Every start and every `db:sync` runs it, so a sync that
 * rewrote what was already there wrote the user field definitions on each.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  recordStatements,
  type RecordedStatement,
} from "../../../../__tests__/helpers/record-statements";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { Logger } from "../../../../services/shared";
import { UserFieldDefinitionService } from "../user-field-definition-service";

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

/** The statements of `calls` that write the user field definitions. */
const definitionWrites = (calls: readonly RecordedStatement[]) =>
  calls.filter(
    call =>
      /^\s*(insert|update|delete|replace)\b/i.test(call.text) &&
      /user_field_definitions/i.test(call.text)
  );

describeEachDialect("a sync of the code user fields", dialect => {
  let current: TestNextly;

  beforeEach(async () => {
    current = await createTestNextly({ dialect });
  });

  afterEach(async () => {
    await current.destroy();
  });

  /** The definition writes of one sync of `fields`. */
  async function writesOf(
    fields: Array<{ name: string; [key: string]: unknown }>
  ): Promise<RecordedStatement[]> {
    const service = new UserFieldDefinitionService(current.adapter, logger);
    const recorder = await recordStatements(current.adapter, dialect);
    try {
      await service.syncCodeFields(fields);
    } finally {
      recorder.uninstall();
    }
    return definitionWrites(recorder.calls);
  }

  it("writes nothing when none is declared and none is stored", async () => {
    expect(await writesOf([])).toEqual([]);
  });

  it("writes nothing when the declared fields are the ones stored", async () => {
    const fields = [
      { name: "bio", type: "text", label: "Bio" },
      { name: "company", type: "text", label: "Company" },
    ];
    await writesOf(fields);

    expect(await writesOf(fields)).toEqual([]);
  });

  it("writes the one field that changed, and no other", async () => {
    await writesOf([
      { name: "bio", type: "text", label: "Bio" },
      { name: "company", type: "text", label: "Company" },
    ]);

    const writes = await writesOf([
      { name: "bio", type: "text", label: "About you" },
      { name: "company", type: "text", label: "Company" },
    ]);

    expect(writes).toHaveLength(1);
    expect(writes[0]?.text).toMatch(/^\s*update\b/i);
    expect(writes[0]?.values).toContain("About you");
  });

  it("removes a field no longer declared, and writes nothing else", async () => {
    await writesOf([
      { name: "bio", type: "text", label: "Bio" },
      { name: "company", type: "text", label: "Company" },
    ]);

    const writes = await writesOf([
      { name: "bio", type: "text", label: "Bio" },
    ]);

    expect(writes).toHaveLength(1);
    expect(writes[0]?.text).toMatch(/^\s*delete\b/i);
  });
});
