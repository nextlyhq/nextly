// @vitest-environment jsdom

/**
 * Preview runs the form as a visitor meets it: its conditions show and hide
 * fields as the answers change, the site's own checks refuse what the site
 * would, hidden fields can be shown, and a submission shows what comes next
 * while saving and sending nothing.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { AnyFormField } from "../../../types";
import { FormBuilderProvider } from "../../context/FormBuilderContext";

import { FormPreview } from "./FormPreview";

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const COMPANY: AnyFormField = {
  type: "text",
  name: "company",
  label: "Company",
};
/** Asked only once Company is answered. */
const ROLE: AnyFormField = {
  type: "text",
  name: "role",
  label: "Your role",
  conditionalLogic: {
    enabled: true,
    action: "show",
    operator: "AND",
    conditions: [{ field: "company", comparison: "isNotEmpty" }],
  },
};
const EMAIL: AnyFormField = {
  type: "email",
  name: "email",
  label: "Email",
  required: true,
};
const SOURCE: AnyFormField = {
  type: "hidden",
  name: "source",
  label: "Source",
  defaultValue: "website",
};

function view(fields: AnyFormField[]) {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(
    <FormBuilderProvider
      initialData={{
        fields,
        settings: {
          confirmationType: "message",
          successMessage: "Thanks, we'll be in touch.",
        },
      }}
    >
      <FormPreview fields={fields} formData={{ name: "Contact" }} />
    </FormBuilderProvider>
  );
  return { user: userEvent.setup(), fetchMock };
}

const submit = () => screen.getByRole("button", { name: "Submit" });

describe("the preview", () => {
  it("shows a field once the answer its condition reads is given", async () => {
    const { user } = view([COMPANY, ROLE]);
    expect(screen.queryByRole("textbox", { name: "Your role" })).toBeNull();

    await user.type(screen.getByRole("textbox", { name: "Company" }), "Acme");

    expect(screen.getByRole("textbox", { name: "Your role" })).toBeVisible();
  });

  it("refuses what the site refuses, with the site's own message", async () => {
    const { user } = view([EMAIL]);
    await user.type(
      screen.getByRole("textbox", { name: /Email/ }),
      "not-an-email"
    );
    await user.click(submit());

    // The checks are the submission's own, so a malformed address is
    // refused here exactly as the site refuses it.
    expect(screen.queryByText("Thanks, we'll be in touch.")).toBeNull();
    expect(screen.getByText(/valid email/i)).toBeVisible();
  });

  it("asks for a required answer left empty", async () => {
    const { user } = view([EMAIL]);
    await user.click(submit());
    expect(screen.queryByText("Thanks, we'll be in touch.")).toBeNull();
    // Said under the field, as the site says it, not merely withheld.
    expect(screen.getByText(/required/i)).toBeVisible();
  });

  it("shows what comes next on a good submission, and sends nothing", async () => {
    const { user, fetchMock } = view([EMAIL, COMPANY, ROLE]);
    await user.type(
      screen.getByRole("textbox", { name: /Email/ }),
      "ada@example.com"
    );
    await user.click(submit());

    expect(screen.getByText("Thanks, we'll be in touch.")).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks only the fields a visitor sees", async () => {
    // A required field a condition hides is not on the visitor's page, so it
    // cannot hold the submission back here.
    const { user } = view([COMPANY, { ...ROLE, required: true }]);
    await user.click(submit());
    expect(screen.getByText("Thanks, we'll be in touch.")).toBeVisible();
  });

  it("shows hidden fields on request, each saying why it is hidden", async () => {
    const { user } = view([COMPANY, ROLE, SOURCE]);
    expect(screen.queryByText(/Hidden field:/)).toBeNull();
    expect(screen.queryByText(/Hidden by a condition:/)).toBeNull();

    await user.click(
      screen.getByRole("switch", { name: "Show hidden fields" })
    );

    expect(screen.getByText(/Hidden field:/)).toBeVisible();
    expect(screen.getByText(/Hidden by a condition:/)).toBeVisible();
  });

  it("draws the form at a phone's width on request", async () => {
    const { user } = view([COMPANY]);
    const desktop = screen.getByRole("button", { name: "Desktop" });
    const phone = screen.getByRole("button", { name: "Phone" });
    expect(desktop).toHaveAttribute("aria-pressed", "true");

    await user.click(phone);

    expect(phone).toHaveAttribute("aria-pressed", "true");
    expect(desktop).toHaveAttribute("aria-pressed", "false");
    expect(
      document.querySelector('[data-preview-device="phone"]')
    ).not.toBeNull();
  });

  it("starts again on Reset", async () => {
    const { user } = view([COMPANY, ROLE]);
    await user.type(screen.getByRole("textbox", { name: "Company" }), "Acme");
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("textbox", { name: "Company" })).toHaveValue("");
    expect(screen.queryByRole("textbox", { name: "Your role" })).toBeNull();
  });
});
