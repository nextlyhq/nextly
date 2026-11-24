// The real records a template offers reach the admin exactly as the loader
// gave them: both answers are marked so the catch-all never rewrites a date in
// the installation's timezone on the way.

import { describe, expect, it, vi } from "vitest";

vi.mock("../../../dispatcher/helpers/di", () => ({
  getEmailProviderServiceFromDI: vi.fn(),
  getEmailTemplateServiceFromDI: vi.fn(),
}));
vi.mock("../../../dispatcher/helpers/authenticated-user", () => ({
  requireAuthenticatedUser: () => ({ id: "u-1", roles: [] }),
}));
vi.mock("../sample-records", () => ({
  listSampleRecords: vi.fn().mockResolvedValue({
    label: "A real order",
    items: [{ id: "o-1", label: "2026-01-01T00:00:00.000Z" }],
  }),
  loadSampleRecord: vi
    .fn()
    .mockResolvedValue({ placedAt: "2026-01-01T00:00:00.000Z" }),
}));

import { SKIP_DATE_FORMATTING_HEADER } from "../../../api/response-shapes";
import { getEmailTemplateServiceFromDI } from "../../../dispatcher/helpers/di";
import { dispatchEmailTemplates } from "../../../dispatcher/handlers/email-dispatcher";

function wireTemplates() {
  vi.mocked(getEmailTemplateServiceFromDI).mockReturnValue({
    getTemplate: vi.fn().mockResolvedValue({ id: "t-1", slug: "shipped" }),
    ownerSampleRecords: vi.fn().mockReturnValue(undefined),
  } as never);
}

describe("a template's real records, as the dispatcher answers them", () => {
  it("lists them, with what they are, marked to keep their text as given", async () => {
    wireTemplates();
    const response = (await dispatchEmailTemplates(
      "listSampleRecords",
      { templateId: "t-1" },
      undefined
    )) as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get(SKIP_DATE_FORMATTING_HEADER)).toBe("1");
    expect(await response.json()).toMatchObject({
      items: [{ id: "o-1", label: "2026-01-01T00:00:00.000Z" }],
      meta: { label: "A real order", total: 1 },
    });
  });

  it("loads one's values, marked so a date is never rewritten", async () => {
    wireTemplates();
    const response = (await dispatchEmailTemplates(
      "loadSampleRecord",
      { templateId: "t-1", recordId: "o-1" },
      undefined
    )) as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get(SKIP_DATE_FORMATTING_HEADER)).toBe("1");
    expect(await response.json()).toEqual({
      id: "o-1",
      variables: { placedAt: "2026-01-01T00:00:00.000Z" },
    });
  });
});
