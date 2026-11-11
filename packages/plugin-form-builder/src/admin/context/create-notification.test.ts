/**
 * A new notification starts with the team's starter message, so it sends as
 * soon as it has an address. Before the starter messages it started with none
 * and, until someone wrote an email in Settings › Email, never sent at all.
 */
import { describe, expect, it } from "vitest";

import { FORM_SUBMISSION_TEMPLATE } from "../../emails/starter-messages";
import { createNotification } from "./FormBuilderContext";

describe("createNotification", () => {
  it("starts a new rule on the team's starter message", () => {
    const created = createNotification();
    expect(created.recipientType).toBe("static");
    expect(created.templateSlug).toBe(FORM_SUBMISSION_TEMPLATE);
  });
});
