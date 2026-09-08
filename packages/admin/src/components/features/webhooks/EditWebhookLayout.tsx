"use client";

/**
 * The order the edit page's three regions appear in.
 *
 * A component rather than three siblings in the page, because the ORDER is the
 * decision and a decision spread across a JSX body is one nothing can hold. The
 * page hands over what goes in each region; where they land is settled here,
 * once, and a test of this component is therefore a test of what a reader gets
 * — not of a fixture that happens to be arranged the same way.
 *
 * The order, and why:
 *
 * 1. `credential` — the signing secret. What a person copies when WIRING UP the
 *    endpoint, which is the task they arrive to do.
 * 2. `configuration` — the form. What they came to change on every later visit.
 * 3. `dangerZone` — deletion. The one irreversible act, last, because a
 *    destructive control where a reader lands is reached by accident more often
 *    than on purpose.
 *
 * `credential` is optional: an endpoint has no secret until it exists, so the
 * create page passes none and the region is absent rather than empty.
 *
 * @module components/features/webhooks/EditWebhookLayout
 */

import type React from "react";

export interface EditWebhookLayoutProps {
  /** The signing secret and its acts. Absent while creating. */
  credential?: React.ReactNode;
  configuration: React.ReactNode;
  dangerZone?: React.ReactNode;
}

export const EditWebhookLayout: React.FC<EditWebhookLayoutProps> = ({
  credential,
  configuration,
  dangerZone,
}) => {
  return (
    <div data-testid="edit-webhook-layout">
      {credential ? (
        <div data-testid="region-credential">{credential}</div>
      ) : null}
      <div data-testid="region-configuration">{configuration}</div>
      {dangerZone ? <div data-testid="region-danger">{dangerZone}</div> : null}
    </div>
  );
};
