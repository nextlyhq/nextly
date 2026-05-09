// Regression tests for the form-dispatcher op-types. Pin the canonical
// Response shapes per spec §5.1 so the handlers cannot regress.
//
// Coverage target (one representative test per op-type):
//   respondList:     listForms (paginated)
//   respondDoc:      getFormBySlug
//   respondAction:   submitForm (non-CRUD mutation; 201 + serverside toast)

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../helpers/di", () => ({
  getCollectionsHandlerFromDI: vi.fn(),
}));

import { NextlyError } from "../../../errors";
import type { ServiceContainer } from "../../../services";
import { getCollectionsHandlerFromDI } from "../../helpers/di";
import { dispatchForms } from "../form-dispatcher";

type CollectionsHandlerLike = {
  listEntries: ReturnType<typeof vi.fn>;
  createEntry: ReturnType<typeof vi.fn>;
};

function makeContainer(handler: CollectionsHandlerLike): ServiceContainer {
  // The dispatcher prefers the DI-registered handler; we wire DI below
  // so this fallback container only needs to satisfy the type signature.
  return { collections: handler } as unknown as ServiceContainer;
}

function wireHandler(handler: CollectionsHandlerLike) {
  vi.mocked(getCollectionsHandlerFromDI).mockReturnValue(
    handler as unknown as ReturnType<typeof getCollectionsHandlerFromDI>
  );
}

beforeEach(() => {
  vi.mocked(getCollectionsHandlerFromDI).mockReset();
});

describe("dispatchForms, paginated lists (respondList)", () => {
  it("listForms returns Response with { items, meta } body and 200 status", async () => {
    const fakeForms = [{ id: "f1", slug: "contact" }];
    const handler: CollectionsHandlerLike = {
      listEntries: vi.fn().mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "ok",
        data: {
          docs: fakeForms,
          totalDocs: 1,
          limit: 100,
          page: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        },
      }),
      createEntry: vi.fn(),
    };
    wireHandler(handler);

    const result = await dispatchForms(
      makeContainer(handler),
      "listForms",
      {},
      undefined
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    const body = await response.json();
    expect(body).toEqual({
      items: fakeForms,
      meta: {
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    });
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("docs");
  });
});

describe("dispatchForms, single-doc reads (respondDoc)", () => {
  it("getFormBySlug returns bare doc body", async () => {
    const fakeForm = { id: "f1", slug: "contact", fields: [] };
    const handler: CollectionsHandlerLike = {
      listEntries: vi.fn().mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "ok",
        data: {
          docs: [fakeForm],
          totalDocs: 1,
          limit: 1,
          page: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        },
      }),
      createEntry: vi.fn(),
    };
    wireHandler(handler);

    const result = await dispatchForms(
      makeContainer(handler),
      "getFormBySlug",
      { slug: "contact" },
      undefined
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(fakeForm);
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("item");
  });
});

describe("dispatchForms, actions (respondAction)", () => {
  it("submitForm returns { message, submissionId } body and 201 status", async () => {
    const fakeForm = {
      id: "f1",
      slug: "contact",
      fields: [
        { name: "email", label: "Email", type: "text", required: true },
      ],
      settings: { successMessage: "Thanks for reaching out!" },
    };
    const fakeSubmission = { id: "s1" };
    const handler: CollectionsHandlerLike = {
      // submitForm calls listEntries once (to look up the published
      // form by slug) and createEntry once (to write the submission).
      // The mocks below cover both calls.
      listEntries: vi.fn().mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "ok",
        data: {
          docs: [fakeForm],
          totalDocs: 1,
          limit: 1,
          page: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        },
      }),
      createEntry: vi.fn().mockResolvedValue({
        success: true,
        statusCode: 201,
        message: "Created",
        data: fakeSubmission,
      }),
    };
    wireHandler(handler);

    const result = await dispatchForms(
      makeContainer(handler),
      "submitForm",
      { slug: "contact" },
      { data: { email: "alice@example.com" } }
    );

    const response = result as Response;
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      message: "Thanks for reaching out!",
      submissionId: "s1",
    });
    // Regression guard: respondAction does not nest under data/item.
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("item");
  });
});

describe("dispatchForms('submitForm'), validation errors", () => {
  // submitForm throws a NextlyError with code `VALIDATION_ERROR` that
  // the dispatcher's catch block canonicalises into
  // `{ error: { code, data: { errors: [...] } } }`. These regression
  // tests guard against a refactor silently reverting to the old
  // `{ status: 400, message, errors }` body shape.

  it("throws VALIDATION_ERROR with REQUIRED code when a required field is empty", async () => {
    // Form has a single required `email` field; we submit an empty
    // string so the dispatcher's required-field loop fires and pushes a
    // single validation error with `code: "REQUIRED"`.
    const fakeForm = {
      id: "f1",
      slug: "contact",
      fields: [
        { name: "email", label: "Email", type: "text", required: true },
      ],
      settings: { successMessage: "Thanks!" },
    };
    const handler: CollectionsHandlerLike = {
      // Only listEntries is exercised; createEntry must not be called
      // because validation throws before submission insert.
      listEntries: vi.fn().mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "ok",
        data: {
          docs: [fakeForm],
          totalDocs: 1,
          limit: 1,
          page: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        },
      }),
      createEntry: vi.fn(),
    };
    wireHandler(handler);

    let thrownErr: unknown;
    try {
      await dispatchForms(
        makeContainer(handler),
        "submitForm",
        { slug: "contact" },
        { data: { email: "" } }
      );
    } catch (err) {
      thrownErr = err;
    }

    // The dispatcher throws (it does not return a legacy { status,
    // errors } body). The framework dispatcher's catch block is what
    // turns this into a wire response.
    expect(NextlyError.is(thrownErr)).toBe(true);
    const err = thrownErr as NextlyError;
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.statusCode).toBe(400);
    expect(err.publicData).toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({
          path: "email",
          code: "REQUIRED",
          message: expect.any(String),
        }),
      ]),
    });
    // Regression guard: createEntry must not be invoked when validation
    // fails, otherwise we would persist invalid submissions.
    expect(handler.createEntry).not.toHaveBeenCalled();
  });

  it("throws VALIDATION_ERROR with MISSING_FIELD code when body has no `data`", async () => {
    // The MISSING_FIELD branch fires before the form lookup, so
    // listEntries should not be called either.
    const handler: CollectionsHandlerLike = {
      listEntries: vi.fn(),
      createEntry: vi.fn(),
    };
    wireHandler(handler);

    let thrownErr: unknown;
    try {
      await dispatchForms(
        makeContainer(handler),
        "submitForm",
        { slug: "contact" },
        // Body is an empty object, i.e. no `data` field at all.
        {}
      );
    } catch (err) {
      thrownErr = err;
    }

    expect(NextlyError.is(thrownErr)).toBe(true);
    const err = thrownErr as NextlyError;
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.statusCode).toBe(400);
    expect(err.publicData).toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({
          path: "data",
          code: "MISSING_FIELD",
          message: expect.any(String),
        }),
      ]),
    });
    // The dispatcher must short-circuit before any service calls.
    expect(handler.listEntries).not.toHaveBeenCalled();
    expect(handler.createEntry).not.toHaveBeenCalled();
  });
});
