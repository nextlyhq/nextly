// Regression tests for the email-dispatcher op-types. Pin the canonical
// Response shapes per spec §5.1 so the handlers cannot regress.
//
// The dispatcher hosts TWO entrypoints (providers + templates), so the
// coverage target spans both.
//
// Provider coverage (one representative test per op-type):
//   respondData:     listProviders (non-paginated array)
//   respondDoc:      getProvider
//   respondMutation: createProvider (201), updateProvider (200)
//   respondAction:   deleteProvider, setDefault, testProvider
//
// Template coverage:
//   respondData:     listTemplates, getLayout, previewTemplate
//   respondDoc:      getTemplate
//   respondMutation: createTemplate (201), updateTemplate (200)
//   respondAction:   deleteTemplate, updateLayout

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../helpers/di", () => ({
  getEmailProviderServiceFromDI: vi.fn(),
  getEmailTemplateServiceFromDI: vi.fn(),
}));

import {
  getEmailProviderServiceFromDI,
  getEmailTemplateServiceFromDI,
} from "../../helpers/di";
import {
  dispatchEmailProviders,
  dispatchEmailTemplates,
} from "../email-dispatcher";

type ProviderService = {
  listProviders: ReturnType<typeof vi.fn>;
  createProvider: ReturnType<typeof vi.fn>;
  getProvider: ReturnType<typeof vi.fn>;
  updateProvider: ReturnType<typeof vi.fn>;
  deleteProvider: ReturnType<typeof vi.fn>;
  setDefault: ReturnType<typeof vi.fn>;
  testProvider: ReturnType<typeof vi.fn>;
};

type TemplateService = {
  listTemplates: ReturnType<typeof vi.fn>;
  createTemplate: ReturnType<typeof vi.fn>;
  getTemplate: ReturnType<typeof vi.fn>;
  updateTemplate: ReturnType<typeof vi.fn>;
  deleteTemplate: ReturnType<typeof vi.fn>;
  previewTemplate: ReturnType<typeof vi.fn>;
  getLayout: ReturnType<typeof vi.fn>;
  updateLayout: ReturnType<typeof vi.fn>;
};

function makeProviderService(
  overrides: Partial<ProviderService> = {}
): ProviderService {
  return {
    listProviders: vi.fn(),
    createProvider: vi.fn(),
    getProvider: vi.fn(),
    updateProvider: vi.fn(),
    deleteProvider: vi.fn(),
    setDefault: vi.fn(),
    testProvider: vi.fn(),
    ...overrides,
  };
}

function makeTemplateService(
  overrides: Partial<TemplateService> = {}
): TemplateService {
  return {
    listTemplates: vi.fn(),
    createTemplate: vi.fn(),
    getTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    previewTemplate: vi.fn(),
    getLayout: vi.fn(),
    updateLayout: vi.fn(),
    ...overrides,
  };
}

function wireProviders(svc: ProviderService) {
  vi.mocked(getEmailProviderServiceFromDI).mockReturnValue(
    svc as unknown as ReturnType<typeof getEmailProviderServiceFromDI>
  );
}

function wireTemplates(svc: TemplateService) {
  vi.mocked(getEmailTemplateServiceFromDI).mockReturnValue(
    svc as unknown as ReturnType<typeof getEmailTemplateServiceFromDI>
  );
}

beforeEach(() => {
  vi.mocked(getEmailProviderServiceFromDI).mockReset();
  vi.mocked(getEmailTemplateServiceFromDI).mockReset();
});

// ============================================================
// Email providers
// ============================================================

describe("dispatchEmailProviders, non-paginated reads (respondData)", () => {
  it("listProviders returns { providers: [...] } body and 200 status", async () => {
    const fakeProviders = [
      { id: "p1", name: "Resend" },
      { id: "p2", name: "SES" },
    ];
    wireProviders(
      makeProviderService({
        listProviders: vi.fn().mockResolvedValue(fakeProviders),
      })
    );

    const result = await dispatchEmailProviders("listProviders", {}, undefined);

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    const body = await response.json();
    expect(body).toEqual({ providers: fakeProviders });
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("items");
  });
});

describe("dispatchEmailProviders, single-doc reads (respondDoc)", () => {
  it("getProvider returns bare doc body", async () => {
    const fakeProvider = { id: "p1", name: "Resend" };
    wireProviders(
      makeProviderService({
        getProvider: vi.fn().mockResolvedValue(fakeProvider),
      })
    );

    const result = await dispatchEmailProviders(
      "getProvider",
      { providerId: "p1" },
      undefined
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(fakeProvider);
    expect(body).not.toHaveProperty("data");
  });
});

describe("dispatchEmailProviders, mutations (respondMutation)", () => {
  it("createProvider returns { message, item } body and 201 status", async () => {
    const fakeProvider = { id: "p1", name: "Resend" };
    wireProviders(
      makeProviderService({
        createProvider: vi.fn().mockResolvedValue(fakeProvider),
      })
    );

    const result = await dispatchEmailProviders(
      "createProvider",
      {},
      { name: "Resend" }
    );

    const response = result as Response;
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      message: "Email provider created.",
      item: fakeProvider,
    });
  });

  it("updateProvider returns { message, item } body and 200 status", async () => {
    const fakeProvider = { id: "p1", name: "Resend (updated)" };
    wireProviders(
      makeProviderService({
        updateProvider: vi.fn().mockResolvedValue(fakeProvider),
      })
    );

    const result = await dispatchEmailProviders(
      "updateProvider",
      { providerId: "p1" },
      { name: "Resend (updated)" }
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      message: "Email provider updated.",
      item: fakeProvider,
    });
  });
});

describe("dispatchEmailProviders, actions (respondAction)", () => {
  it("deleteProvider returns { message, providerId } body and 200 status", async () => {
    wireProviders(
      makeProviderService({
        deleteProvider: vi.fn().mockResolvedValue(undefined),
      })
    );

    const result = await dispatchEmailProviders(
      "deleteProvider",
      { providerId: "p1" },
      undefined
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      message: "Email provider deleted.",
      providerId: "p1",
    });
  });

  it("setDefault returns { message, provider } body and 200 status", async () => {
    const fakeProvider = { id: "p1", name: "Resend", isDefault: true };
    wireProviders(
      makeProviderService({
        setDefault: vi.fn().mockResolvedValue(fakeProvider),
      })
    );

    const result = await dispatchEmailProviders(
      "setDefault",
      { providerId: "p1" },
      undefined
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      message: "Default email provider updated.",
      provider: fakeProvider,
    });
  });

  it("testProvider returns { message, result } body and 200 status", async () => {
    const fakeResult = { success: true };
    wireProviders(
      makeProviderService({
        testProvider: vi.fn().mockResolvedValue(fakeResult),
      })
    );

    const result = await dispatchEmailProviders(
      "testProvider",
      { providerId: "p1" },
      { email: "ops@example.com" }
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      message: "Test email dispatched.",
      result: fakeResult,
    });
  });
});

// ============================================================
// Email templates
// ============================================================

describe("dispatchEmailTemplates, non-paginated reads (respondData)", () => {
  it("listTemplates returns { templates: [...] } body and 200 status", async () => {
    const fakeTemplates = [
      { id: "t1", slug: "welcome" },
      { id: "t2", slug: "password-reset" },
    ];
    wireTemplates(
      makeTemplateService({
        listTemplates: vi.fn().mockResolvedValue(fakeTemplates),
      })
    );

    const result = await dispatchEmailTemplates("listTemplates", {}, undefined);

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ templates: fakeTemplates });
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("items");
  });

  it("getLayout returns bare { header, footer } body", async () => {
    const fakeLayout = { header: "<h1>Hi</h1>", footer: "<p>Bye</p>" };
    wireTemplates(
      makeTemplateService({
        getLayout: vi.fn().mockResolvedValue(fakeLayout),
      })
    );

    const result = await dispatchEmailTemplates("getLayout", {}, undefined);

    const response = result as Response;
    const body = await response.json();
    expect(body).toEqual(fakeLayout);
  });

  it("previewTemplate returns bare { subject, html } body", async () => {
    const fakePreview = {
      subject: "Welcome, Alice",
      html: "<p>Hello Alice</p>",
    };
    wireTemplates(
      makeTemplateService({
        previewTemplate: vi.fn().mockResolvedValue(fakePreview),
      })
    );

    const result = await dispatchEmailTemplates(
      "previewTemplate",
      { templateId: "t1" },
      { data: { name: "Alice" } }
    );

    const response = result as Response;
    const body = await response.json();
    expect(body).toEqual(fakePreview);
    expect(body).not.toHaveProperty("data");
  });
});

describe("dispatchEmailTemplates, single-doc reads (respondDoc)", () => {
  it("getTemplate returns bare doc body", async () => {
    const fakeTemplate = { id: "t1", slug: "welcome" };
    wireTemplates(
      makeTemplateService({
        getTemplate: vi.fn().mockResolvedValue(fakeTemplate),
      })
    );

    const result = await dispatchEmailTemplates(
      "getTemplate",
      { templateId: "t1" },
      undefined
    );

    const response = result as Response;
    const body = await response.json();
    expect(body).toEqual(fakeTemplate);
    expect(body).not.toHaveProperty("data");
  });
});

describe("dispatchEmailTemplates, mutations (respondMutation)", () => {
  it("createTemplate returns { message, item } body and 201 status", async () => {
    const fakeTemplate = { id: "t1", slug: "welcome" };
    wireTemplates(
      makeTemplateService({
        createTemplate: vi.fn().mockResolvedValue(fakeTemplate),
      })
    );

    const result = await dispatchEmailTemplates(
      "createTemplate",
      {},
      { slug: "welcome" }
    );

    const response = result as Response;
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      message: "Email template created.",
      item: fakeTemplate,
    });
  });

  it("updateTemplate returns { message, item } body and 200 status", async () => {
    const fakeTemplate = { id: "t1", slug: "welcome" };
    wireTemplates(
      makeTemplateService({
        updateTemplate: vi.fn().mockResolvedValue(fakeTemplate),
      })
    );

    const result = await dispatchEmailTemplates(
      "updateTemplate",
      { templateId: "t1" },
      { subject: "Hello" }
    );

    const response = result as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      message: "Email template updated.",
      item: fakeTemplate,
    });
  });
});

describe("dispatchEmailTemplates, actions (respondAction)", () => {
  it("deleteTemplate returns { message, templateId } body and 200 status", async () => {
    wireTemplates(
      makeTemplateService({
        deleteTemplate: vi.fn().mockResolvedValue(undefined),
      })
    );

    const result = await dispatchEmailTemplates(
      "deleteTemplate",
      { templateId: "t1" },
      undefined
    );

    const response = result as Response;
    const body = await response.json();
    expect(body).toEqual({
      message: "Email template deleted.",
      templateId: "t1",
    });
  });

  it("updateLayout returns just { message } body and 200 status", async () => {
    wireTemplates(
      makeTemplateService({
        updateLayout: vi.fn().mockResolvedValue(undefined),
      })
    );

    const result = await dispatchEmailTemplates(
      "updateLayout",
      {},
      { header: "<h1>Hi</h1>" }
    );

    const response = result as Response;
    const body = await response.json();
    expect(body).toEqual({ message: "Email layout updated." });
  });
});
