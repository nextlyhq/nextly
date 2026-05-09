// Regression tests for the user-field-dispatcher op-types. Pin the
// canonical Response shapes per spec §5.1 so the handlers cannot
// regress.
//
// Coverage target (one representative test per op-type):
//   respondData:     listUserFields (non-paginated, surfaces adminConfig)
//   respondDoc:      getField
//   respondMutation: createField (201), updateField (200)
//   respondAction:   deleteField, reorderFields

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../helpers/di", () => ({
  getConfigFromDI: vi.fn(),
  getUserFieldDefinitionServiceFromDI: vi.fn(),
  getUserExtSchemaServiceFromDI: vi.fn(),
  getAdapterFromDI: vi.fn(),
}));

import {
  getAdapterFromDI,
  getConfigFromDI,
  getUserExtSchemaServiceFromDI,
  getUserFieldDefinitionServiceFromDI,
} from "../../helpers/di";
import { dispatchUserFields } from "../user-field-dispatcher";

type FieldDefinitionService = {
  listFields: ReturnType<typeof vi.fn>;
  createField: ReturnType<typeof vi.fn>;
  getField: ReturnType<typeof vi.fn>;
  updateField: ReturnType<typeof vi.fn>;
  deleteField: ReturnType<typeof vi.fn>;
  reorderFields: ReturnType<typeof vi.fn>;
};

type UserExtSchemaService = {
  reloadMergedFields: ReturnType<typeof vi.fn>;
  ensureUserExtSchema: ReturnType<typeof vi.fn>;
};

function makeFieldDefinitionService(
  overrides: Partial<FieldDefinitionService> = {}
): FieldDefinitionService {
  return {
    listFields: vi.fn(),
    createField: vi.fn(),
    getField: vi.fn(),
    updateField: vi.fn(),
    deleteField: vi.fn(),
    reorderFields: vi.fn(),
    ...overrides,
  };
}

function makeUserExtSchemaService(): UserExtSchemaService {
  // The mutating handlers all call syncUserExtSchema after the underlying
  // mutation; resolve to no-op so the wire-shape assertion is what's
  // under test.
  return {
    reloadMergedFields: vi.fn().mockResolvedValue(undefined),
    ensureUserExtSchema: vi.fn().mockResolvedValue(undefined),
  };
}

function wireDi(field: FieldDefinitionService) {
  vi.mocked(getConfigFromDI).mockReturnValue({
    users: { admin: { hidden: ["createdAt"] } },
  } as unknown as ReturnType<typeof getConfigFromDI>);
  vi.mocked(getUserFieldDefinitionServiceFromDI).mockReturnValue(
    field as unknown as ReturnType<typeof getUserFieldDefinitionServiceFromDI>
  );
  vi.mocked(getUserExtSchemaServiceFromDI).mockReturnValue(
    makeUserExtSchemaService() as unknown as ReturnType<
      typeof getUserExtSchemaServiceFromDI
    >
  );
  // Adapter only needed by syncUserExtSchema; null is fine for the
  // tests because reloadMergedFields/ensureUserExtSchema are stubs.
  vi.mocked(getAdapterFromDI).mockReturnValue(undefined);
}

beforeEach(() => {
  vi.mocked(getConfigFromDI).mockReset();
  vi.mocked(getUserFieldDefinitionServiceFromDI).mockReset();
  vi.mocked(getUserExtSchemaServiceFromDI).mockReset();
  vi.mocked(getAdapterFromDI).mockReset();
});

describe("dispatchUserFields, non-paginated reads (respondData)", () => {
  it("listUserFields returns { fields, total, adminConfig } body and 200 status", async () => {
    const fakeFields = [
      { id: "f1", name: "bio" },
      { id: "f2", name: "twitter" },
    ];
    wireDi(
      makeFieldDefinitionService({
        listFields: vi.fn().mockResolvedValue(fakeFields),
      })
    );

    const result = await dispatchUserFields("listUserFields", {}, undefined);

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    const body = await response.json();
    expect(body).toEqual({
      fields: fakeFields,
      total: 2,
      adminConfig: { hidden: ["createdAt"] },
    });
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("meta");
  });
});

describe("dispatchUserFields, single-doc reads (respondDoc)", () => {
  it("getField returns bare doc body", async () => {
    const fakeField = { id: "f1", name: "bio", type: "text" };
    wireDi(
      makeFieldDefinitionService({
        getField: vi.fn().mockResolvedValue(fakeField),
      })
    );

    const result = await dispatchUserFields(
      "getField",
      { fieldId: "f1" },
      undefined
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(fakeField);
    expect(body).not.toHaveProperty("data");
  });
});

describe("dispatchUserFields, mutations (respondMutation)", () => {
  it("createField returns { message, item } body and 201 status", async () => {
    const fakeField = { id: "f1", name: "bio", type: "text" };
    wireDi(
      makeFieldDefinitionService({
        createField: vi.fn().mockResolvedValue(fakeField),
      })
    );

    const result = await dispatchUserFields(
      "createField",
      {},
      { name: "bio", type: "text" }
    );

    const response = result as Response;
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      message: "User field created.",
      item: fakeField,
    });
  });

  it("updateField returns { message, item } body and 200 status", async () => {
    const fakeField = { id: "f1", name: "bio (renamed)" };
    wireDi(
      makeFieldDefinitionService({
        updateField: vi.fn().mockResolvedValue(fakeField),
      })
    );

    const result = await dispatchUserFields(
      "updateField",
      { fieldId: "f1" },
      { name: "bio (renamed)" }
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      message: "User field updated.",
      item: fakeField,
    });
  });
});

describe("dispatchUserFields, actions (respondAction)", () => {
  it("deleteField returns { message, fieldId } body and 200 status", async () => {
    wireDi(
      makeFieldDefinitionService({
        deleteField: vi.fn().mockResolvedValue(undefined),
      })
    );

    const result = await dispatchUserFields(
      "deleteField",
      { fieldId: "f1" },
      undefined
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      message: "User field deleted.",
      fieldId: "f1",
    });
  });

  it("reorderFields returns { message, fields } body and 200 status", async () => {
    const reordered = [
      { id: "f2", name: "twitter", sortOrder: 0 },
      { id: "f1", name: "bio", sortOrder: 1 },
    ];
    wireDi(
      makeFieldDefinitionService({
        reorderFields: vi.fn().mockResolvedValue(reordered),
      })
    );

    const result = await dispatchUserFields(
      "reorderFields",
      {},
      { fieldIds: ["f2", "f1"] }
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      message: "User fields reordered.",
      fields: reordered,
    });
    // Regression guard: respondAction does not nest under data/item.
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("item");
  });
});
