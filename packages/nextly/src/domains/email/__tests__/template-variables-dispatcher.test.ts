/**
 * The admin API checks a template's declared variables on create and update.
 *
 * The route a generated app mounts is the dispatcher, so a malformed
 * declaration must be refused there, before the service stores it; today's
 * declarations still save as they are.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../dispatcher/helpers/di", () => ({
  getEmailProviderServiceFromDI: vi.fn(),
  getEmailTemplateServiceFromDI: vi.fn(),
}));

import { dispatchEmailTemplates } from "../../../dispatcher/handlers/email-dispatcher";
import { getEmailTemplateServiceFromDI } from "../../../dispatcher/helpers/di";

const TEMPLATE = { id: "t1", slug: "orders", name: "Orders" };

let createTemplate: ReturnType<typeof vi.fn>;
let updateTemplate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  createTemplate = vi.fn().mockResolvedValue(TEMPLATE);
  updateTemplate = vi.fn().mockResolvedValue(TEMPLATE);
  vi.mocked(getEmailTemplateServiceFromDI).mockReturnValue({
    createTemplate,
    updateTemplate,
  } as never);
});

const MALFORMED = [{ description: "No name" }];
const TODAY = [{ name: "number", description: "Order", required: true }];

describe("declared variables through the admin API", () => {
  it.each([
    ["createTemplate", {}, () => createTemplate],
    ["updateTemplate", { templateId: "t1" }, () => updateTemplate],
  ] as const)(
    "%s refuses a malformed declaration and stores nothing",
    async (method, params, called) => {
      await expect(
        dispatchEmailTemplates(method, params, {
          name: "Orders",
          variables: MALFORMED,
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(called()).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["createTemplate", {}, () => createTemplate.mock.calls[0]?.[0]],
    [
      "updateTemplate",
      { templateId: "t1" },
      () => updateTemplate.mock.calls[0]?.[1],
    ],
  ] as const)(
    "%s saves today's declarations as they are",
    async (method, params, given) => {
      await dispatchEmailTemplates(method, params, {
        name: "Orders",
        variables: TODAY,
      });
      expect(given()).toMatchObject({ name: "Orders", variables: TODAY });
    }
  );

  it("saves a typed declaration", async () => {
    const typed = [
      { ...TODAY[0], type: "text", label: "Order number", example: "A-1" },
    ];
    await dispatchEmailTemplates(
      "updateTemplate",
      { templateId: "t1" },
      { variables: typed }
    );
    expect(updateTemplate.mock.calls[0]?.[1]).toEqual({ variables: typed });
  });

  it("leaves a save without declarations untouched", async () => {
    await dispatchEmailTemplates(
      "updateTemplate",
      { templateId: "t1" },
      { subject: "Hi" }
    );
    expect(updateTemplate.mock.calls[0]?.[1]).toEqual({ subject: "Hi" });
  });
});
