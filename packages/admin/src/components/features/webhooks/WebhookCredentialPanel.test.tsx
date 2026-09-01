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

import { EditWebhookLayout } from "./EditWebhookLayout";
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
  /*
   * Asserted through `EditWebhookLayout` — the component the page actually
   * renders — rather than through a fixture arranged here. A test that lays out
   * its own regions cannot fail when the PAGE puts them back the other way
   * round, which is the regression worth catching: it would report the ordering
   * as covered while the production order was free to move.
   */
  it("precedes the form in document order, as the page composes it", () => {
    render(
      <EditWebhookLayout
        credential={panel()}
        configuration={
          <form data-testid="config-form">
            <input aria-label="Name" />
          </form>
        }
      />
    );

    const credential = screen.getByTestId("webhook-credential-panel");
    const form = screen.getByTestId("config-form");

    expect(
      credential.compareDocumentPosition(form) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("puts the irreversible act last", () => {
    render(
      <EditWebhookLayout
        credential={panel()}
        configuration={<form data-testid="config-form" />}
        dangerZone={<button type="button">Delete endpoint</button>}
      />
    );

    const form = screen.getByTestId("region-configuration");
    const danger = screen.getByTestId("region-danger");
    expect(
      form.compareDocumentPosition(danger) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  /*
   * The create page has no secret to show, so the region must be absent rather
   * than an empty box asking the author to ignore it.
   */
  it("omits the credential region entirely when there is none", () => {
    render(
      <EditWebhookLayout configuration={<form data-testid="config-form" />} />
    );
    expect(screen.queryByTestId("region-credential")).toBeNull();
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
