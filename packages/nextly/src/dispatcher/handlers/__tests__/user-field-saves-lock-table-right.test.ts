// A user-field save takes the schema lock, and may create the lock table only
// in development. In production the application's database role may hold data
// rights and no DDL rights; creating the table there would refuse a save that
// otherwise succeeds, so a production save takes the lock wherever its table
// exists and never creates it, as a collection save does.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../helpers/di", () => ({
  getConfigFromDI: vi.fn(),
  getUserFieldDefinitionServiceFromDI: vi.fn(),
  getUserExtSchemaServiceFromDI: vi.fn(),
  getAdapterFromDI: vi.fn(),
  getLoggerFromDI: vi.fn(),
}));

// The lock itself is the subject of the integration suite; here only what the
// save asks of it is observed, and the save then runs as the lock would let it.
vi.mock("../../../domains/schema/services/schema-change-exclusion", () => ({
  withSchemaChangeExcluded: vi.fn(
    (_args: unknown, work: () => Promise<unknown>) => work()
  ),
}));

import { withSchemaChangeExcluded } from "../../../domains/schema/services/schema-change-exclusion";
import {
  getAdapterFromDI,
  getConfigFromDI,
  getUserExtSchemaServiceFromDI,
  getUserFieldDefinitionServiceFromDI,
} from "../../helpers/di";
import { dispatchUserFields } from "../user-field-dispatcher";

beforeEach(() => {
  vi.mocked(getConfigFromDI).mockReturnValue(
    {} as ReturnType<typeof getConfigFromDI>
  );
  vi.mocked(getUserFieldDefinitionServiceFromDI).mockReturnValue({
    createField: vi.fn().mockResolvedValue({ id: "f1", name: "bio" }),
  } as unknown as ReturnType<typeof getUserFieldDefinitionServiceFromDI>);
  vi.mocked(getUserExtSchemaServiceFromDI).mockReturnValue({
    reloadMergedFields: vi.fn().mockResolvedValue(undefined),
    ensureUserExtSchema: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof getUserExtSchemaServiceFromDI>);
  // An adapter is registered, so the save takes the lock; the schema sync reads
  // its Drizzle handle.
  vi.mocked(getAdapterFromDI).mockReturnValue({
    getDrizzle: () => ({}),
  } as unknown as ReturnType<typeof getAdapterFromDI>);
  vi.mocked(withSchemaChangeExcluded).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function issuesDdlOfACreate(): Promise<unknown> {
  await dispatchUserFields("createField", {}, { name: "bio", type: "text" });
  expect(withSchemaChangeExcluded).toHaveBeenCalledOnce();
  return vi.mocked(withSchemaChangeExcluded).mock.calls[0]?.[0].issuesDdl;
}

describe("a user-field save's right to create the lock table", () => {
  it("is not asked for in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await issuesDdlOfACreate()).toBe(false);
  });

  it("is asked for in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(await issuesDdlOfACreate()).toBe(true);
  });
});
