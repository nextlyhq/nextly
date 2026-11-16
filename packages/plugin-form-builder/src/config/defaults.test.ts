/**
 * The form config helpers keep every setting they are given, filling only the
 * ones with defaults, so a setting the helper does not name is not dropped on
 * the way through.
 */
import { describe, expect, it } from "vitest";

import type { FormSettings } from "../types";
import { normalizeFormSettings } from "../utils/form-settings";

import { applyFormDefaults, createFormConfig } from "./defaults";

const GIVEN: FormSettings = {
  oneResponse: "ip",
  botCheck: "recaptcha",
  closesAt: "2026-12-06T18:00:00.000Z",
  submissionLimit: 120,
  storeIpAndBrowser: false,
  keepDays: 90,
  internalNote: "Lahore meetup.",
  honeypotEnabled: true,
  redirectUrl: "https://example.com/thanks",
};

const FIELDS = [{ type: "text" as const, name: "name", label: "Name" }];

describe("the form config helpers", () => {
  it.each([
    [
      "applyFormDefaults",
      () =>
        applyFormDefaults({ slug: "rsvp", fields: FIELDS, settings: GIVEN }),
    ],
    [
      "createFormConfig",
      () => createFormConfig("rsvp", FIELDS, { settings: GIVEN }),
    ],
  ])("%s keeps every setting it is given", (_name, build) => {
    const { settings } = build();
    expect(settings).toMatchObject(GIVEN);
    // Read as the submit handler reads it: one response per network, as asked.
    expect(normalizeFormSettings(settings)).toMatchObject({
      oneResponse: "ip",
      botCheck: "recaptcha",
    });
  });

  it("fills the settings that have defaults", () => {
    const { settings } = applyFormDefaults({ slug: "rsvp", fields: FIELDS });
    expect(settings).toMatchObject({
      submitButtonText: "Submit",
      confirmationType: "message",
      allowMultipleSubmissions: true,
    });
  });
});
