"use client";

/**
 * The endpoint's signing secret, and the acts that operate on it.
 *
 * Rendered ABOVE the configuration form, because the two are read at different
 * moments and the secret is read first. Setting an endpoint up means copying
 * this value into the receiving system; that is the task a person arrives to do,
 * and it sat after every configuration field, reachable only by scrolling past
 * the form. A credential belongs to the endpoint rather than inside its
 * settings — the arrangement every developer already knows from the API keys and
 * webhook secrets of the services they integrate with.
 *
 * Editing the configuration is the other moment, and it does not lose by this:
 * the fields keep their own reading order beneath, and the panel is a fixed
 * height that does not grow with the form.
 *
 * NOT rendered while creating. An endpoint has no secret until it exists, so
 * there is nothing here to show and an empty shell would only ask the author to
 * ignore it. The create page therefore mounts this at all.
 *
 * @module components/features/webhooks/WebhookCredentialPanel
 */

import { Button } from "@nextlyhq/ui";
import type React from "react";

import { Eye, List, Loader2, RefreshCw } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import type { WebhookSecretInfo } from "@admin/types/webhooks";

import { SecretLifecycle } from "./SecretLifecycle";

export interface WebhookCredentialPanelProps {
  secrets: WebhookSecretInfo[];
  /** Update permission gates rotation and early expiry, not reading. */
  canManage: boolean;
  onReveal: () => void;
  isRevealing: boolean;
  onRotate: () => void;
  isRotating: boolean;
  onExpireOld: () => void;
  isExpiring: boolean;
  /** Where the delivery log lives, so the panel does not need to know routes. */
  deliveriesHref: string;
}

export const WebhookCredentialPanel: React.FC<WebhookCredentialPanelProps> = ({
  secrets,
  canManage,
  onReveal,
  isRevealing,
  onRotate,
  isRotating,
  onExpireOld,
  isExpiring,
  deliveriesHref,
}) => {
  return (
    <section
      data-testid="webhook-credential-panel"
      aria-label="Signing secret"
      className="mb-6 rounded-lg border border-border bg-card p-4"
    >
      <SecretLifecycle
        secrets={secrets}
        canManage={canManage}
        onExpireOld={onExpireOld}
        isExpiring={isExpiring}
      />

      {/* Wraps rather than overflowing: three labelled buttons exceed a narrow
          settings column, and a control pushed off-screen is one nobody finds. */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onReveal}
          disabled={isRevealing}
        >
          {isRevealing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
          Reveal signing secret
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={onRotate}
          disabled={isRotating}
        >
          {isRotating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Rotate signing secret
        </Button>

        <Link href={deliveriesHref}>
          <Button type="button" variant="outline">
            <List className="h-4 w-4" />
            View deliveries
          </Button>
        </Link>
      </div>
    </section>
  );
};
