"use client";

/**
 * SecretLifecycle — shows an endpoint's active signing secrets and their state
 * during a rotation: the primary that new deliveries are prefixed by, and any
 * overlapping secret still valid until it expires. When an overlapping secret
 * exists a manager can retire it early. Values are display prefixes only; the
 * real secrets are read through the separate reveal action.
 */

import { Badge, Button } from "@nextlyhq/ui";
import type React from "react";

import { Loader2 } from "@admin/components/icons";
import type { WebhookSecretInfo } from "@admin/types/webhooks";

/**
 * A short "in 2 days" / "in 5 hours" for a future instant, or "soon" when it is
 * essentially now. Rendered in the viewer's frame from the ISO instant.
 */
function formatExpiresIn(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "expiring";
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (minutes < 60) {
    return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  if (hours < 48) {
    return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

export interface SecretLifecycleProps {
  secrets: WebhookSecretInfo[];
  /** Update permission gates the "Expire now" control. */
  canManage: boolean;
  onExpireOld: () => void;
  isExpiring: boolean;
}

export const SecretLifecycle: React.FC<SecretLifecycleProps> = ({
  secrets,
  canManage,
  onExpireOld,
  isExpiring,
}) => {
  const hasOverlap = secrets.some(secret => !secret.isPrimary);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-muted-foreground">
          Signing secrets
        </p>
        {hasOverlap && canManage && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onExpireOld}
            disabled={isExpiring}
          >
            {isExpiring ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Expire old secret now
          </Button>
        )}
      </div>

      <ul className="divide-y divide-foreground/10 rounded-md border border-input bg-card">
        {secrets.map(secret => (
          <li
            key={`${secret.prefix}-${secret.createdAt}`}
            className="flex flex-wrap items-center gap-3 px-4 py-3"
          >
            <code className="rounded-none bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
              {secret.prefix}
              {"•".repeat(6)}
            </code>
            {secret.isPrimary ? (
              <Badge variant="success">Primary</Badge>
            ) : (
              <Badge variant="warning">
                Expiring
                {secret.expiresAt
                  ? ` ${formatExpiresIn(secret.expiresAt)}`
                  : ""}
              </Badge>
            )}
          </li>
        ))}
      </ul>

      {hasOverlap && (
        <p className="text-xs text-muted-foreground">
          Deliveries are signed with both secrets until the old one expires, so
          a receiver holding either verifies.
        </p>
      )}
    </section>
  );
};
