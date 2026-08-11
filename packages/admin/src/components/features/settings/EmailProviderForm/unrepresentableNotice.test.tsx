/**
 * What a field says when it cannot show what is stored behind it.
 *
 * Some stored values have no rendering in the control that declared them: an
 * object under a text or password field, a non-boolean under a switch. The
 * value is left out of the form rather than guessed at, so the control renders
 * its empty state — and without a notice on the field, an empty box is
 * indistinguishable from a field that holds nothing at all.
 *
 * A credential is the case that matters most, because the operator cannot
 * check it against anything: the server never sends a secret back.
 */

import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type {
  EmailProviderDescriptor,
  EmailProviderRecord,
} from "@admin/services/emailProviderApi";

import { EmailProviderForm } from "./EmailProviderForm";

const DESCRIPTOR: EmailProviderDescriptor = {
  type: "acme",
  label: "Acme",
  capabilities: {},
  configFields: [
    { name: "apiKey", label: "API Key", kind: "password", secret: true },
    { name: "region", label: "Region", kind: "text", help: "Where to send." },
  ],
};

function provider(configuration: Record<string, unknown>): EmailProviderRecord {
  return {
    id: "ep_1",
    name: "Transactional",
    type: "acme",
    fromEmail: "hello@example.com",
    fromName: "Example",
    configuration,
    isDefault: false,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function renderForm(configuration: Record<string, unknown>): void {
  render(
    <EmailProviderForm
      mode="edit"
      provider={provider(configuration)}
      descriptors={[DESCRIPTOR]}
      isPending={false}
      onSubmit={() => {}}
    />
  );
}

describe("a stored value the control cannot render", () => {
  it("is explained on a SECRET field too", () => {
    // A secret holding an object is masked leaf by leaf, so the value that
    // reaches the form is an object rather than the eight-character mask. A
    // password input has no way to show it, and the field renders blank —
    // which on a credential reads as "there is no key stored", the one reading
    // that would have the operator type a replacement they did not intend.
    renderForm({ apiKey: { primary: "••••••••" }, region: "eu" });

    expect(
      screen.getByText(/stored value cannot be shown by this control/i)
    ).toBeVisible();
  });

  it("keeps the field's own help text alongside it", () => {
    // The notice is added to the description, not swapped in for it: the help
    // text explains what the field is for, and that is still true.
    renderForm({ apiKey: "••••••••", region: { primary: "eu" } });

    expect(screen.getByText(/Where to send\./)).toBeVisible();
    expect(
      screen.getByText(/stored value cannot be shown by this control/i)
    ).toBeVisible();
  });

  it("says nothing when every stored value renders", () => {
    // The control. Both assertions above pass just as well from a form that
    // shows the notice unconditionally, which would tell an operator their
    // perfectly readable configuration cannot be displayed.
    renderForm({ apiKey: "••••••••", region: "eu" });

    expect(
      screen.queryByText(/stored value cannot be shown by this control/i)
    ).not.toBeInTheDocument();
  });
});
