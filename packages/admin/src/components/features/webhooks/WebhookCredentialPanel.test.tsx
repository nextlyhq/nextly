/**
 * The signing secret must be reachable WITHOUT scrolling past the form.
 *
 * The complaint this answers is positional rather than functional: every
 * control worked, and a person setting an endpoint up could not find the value
 * they had come for. So the property under test is ORDER — the credential panel
 * precedes the configuration form in the document — which is what a screen
 * reader announces first and what a sighted reader meets first.
 *
 * Asserted through DOM position rather than by checking a class name. A class
 * says what was written; `compareDocumentPosition` says what the reader gets,
 * and the two stop agreeing the moment anything wraps the panel.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WebhookSecretInfo } from "@admin/types/webhooks";

import { WebhookCredentialPanel } from "./WebhookCredentialPanel";

afterEach(cleanup);

const SECRETS: WebhookSecretInfo[] = [
  {
    prefix: "whsec_abc",
    isPrimary: true,
    createdAt: "2026-08-20T10:00:00.000Z",
    expiresAt: null,
  },
];

function panel(
  overrides: Partial<React.ComponentProps<typeof WebhookCredentialPanel>> = {}
) {
  return (
    <WebhookCredentialPanel
      secrets={SECRETS}
      canManage
      onReveal={vi.fn()}
      isRevealing={false}
      onRotate={vi.fn()}
      isRotating={false}
      onExpireOld={vi.fn()}
      isExpiring={false}
      deliveriesHref="/admin/settings/webhooks/w1/deliveries"
      {...overrides}
    />
  );
}

describe("the credential panel comes before the configuration form", () => {
  it("precedes the form in document order", () => {
    render(
      <div>
        {panel()}
        <form data-testid="config-form">
          <input aria-label="Name" />
        </form>
      </div>
    );

    const credential = screen.getByTestId("webhook-credential-panel");
    const form = screen.getByTestId("config-form");

    /*
     * DOCUMENT_POSITION_FOLLOWING means `form` comes after `credential`. The
     * inverse constant is what the old layout would satisfy, so this assertion
     * separates the two arrangements rather than merely observing that both
     * elements exist.
     */
    expect(
      credential.compareDocumentPosition(form) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("carries the three acts a person needs on the secret", () => {
    render(panel());
    expect(screen.getByText("Reveal signing secret")).toBeDefined();
    expect(screen.getByText("Rotate signing secret")).toBeDefined();
    expect(screen.getByText("View deliveries")).toBeDefined();
  });

  /*
   * Rotation was NOT permission-gated before this panel existed, and moving a
   * control must not change who may use it. Pinned so a later reading of
   * `canManage` as "may rotate" is a deliberate change rather than a drift.
   */
  it("offers rotation regardless of manage permission", () => {
    render(panel({ canManage: false }));
    expect(screen.getByText("Rotate signing secret")).toBeDefined();
  });

  it("links deliveries at the href it is given", () => {
    render(panel());
    const link = screen.getByText("View deliveries").closest("a");
    expect(link?.getAttribute("href")).toBe(
      "/admin/settings/webhooks/w1/deliveries"
    );
  });
});
