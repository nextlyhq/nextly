/**
 * Saying why a selected provider cannot send yet.
 *
 * A provider whose transport library is an optional peer stays selectable
 * rather than hidden or disabled: hiding a supported provider makes it look
 * unsupported, and disabling it states a problem without stating the remedy.
 * What the operator needs is the command, so that is what this renders.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { ProviderAvailabilityNotice } from "./ProviderAvailabilityNotice";

const MISSING = {
  status: "needs-dependency",
  packageName: "nodemailer",
  installCommand: "npm install nodemailer",
  docsUrl: "https://nodemailer.com/smtp/",
} as const;

describe("ProviderAvailabilityNotice", () => {
  it("renders nothing when the provider is ready", () => {
    const { container } = render(
      <ProviderAvailabilityNotice
        providerLabel="Resend"
        availability={{ status: "ready" }}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the server sent no availability at all", () => {
    // A server predating the field sends none. Absent information must not
    // become a warning claiming a package is missing.
    const { container } = render(
      <ProviderAvailabilityNotice providerLabel="SMTP" />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("names the package that is missing", () => {
    render(
      <ProviderAvailabilityNotice providerLabel="SMTP" availability={MISSING} />
    );

    expect(screen.getByText("nodemailer")).toBeInTheDocument();
  });

  it("shows the command verbatim, as one selectable string", () => {
    render(
      <ProviderAvailabilityNotice providerLabel="SMTP" availability={MISSING} />
    );

    // Exact text, not a substring match: an operator copies this into a
    // terminal, so a command split across elements would paste broken.
    expect(screen.getByText("npm install nodemailer")).toBeInTheDocument();
  });

  it("links the documentation when one is given", () => {
    render(
      <ProviderAvailabilityNotice providerLabel="SMTP" availability={MISSING} />
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://nodemailer.com/smtp/");
    // Opening a vendor's docs over the admin would lose unsaved form state.
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("omits the link when no documentation is given", () => {
    render(
      <ProviderAvailabilityNotice
        providerLabel="SMTP"
        availability={{
          status: "needs-dependency",
          packageName: "nodemailer",
          installCommand: "npm install nodemailer",
        }}
      />
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("says the configuration may still be saved", () => {
    render(
      <ProviderAvailabilityNotice providerLabel="SMTP" availability={MISSING} />
    );

    // The form does not block on this. Someone configuring a server they do
    // not administer needs to know the settings will keep.
    expect(screen.getByRole("alert").textContent).toMatch(/save/i);
  });
});
