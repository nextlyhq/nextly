"use client";

/**
 * KeySummary
 *
 * What an API key will be able to do, shown on the create form before the key
 * exists. The answer is the server's, for the chosen type and role, from the
 * same resolution the key's own requests use, so it is what the key gets (a
 * super-admin's read-only key reads every collection, for one). Grouped by
 * resource, each with its actions.
 */

import type { JSX } from "react";

import { Loader2 } from "@admin/components/icons";
import { useApiKeyAbilities } from "@admin/hooks/queries/useApiKeys";
import type { ApiKeyAbility, ApiKeyTokenType } from "@admin/services/apiKeyApi";

export interface KeySummaryProps {
  tokenType: ApiKeyTokenType;
  /** Only for a role-based key; until it is chosen there is nothing to ask. */
  roleId: string | undefined;
}

/**
 * Humanises a resource slug: "email-providers" → "Email Providers". Some
 * resources are named with underscores ("nx_pb_class_usage"), so both split.
 */
function humaniseResource(slug: string): string {
  return slug
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Each resource with its actions, in the order the server listed them. */
function byResource(abilities: ApiKeyAbility[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const { resource, action } of abilities) {
    grouped.set(resource, [...(grouped.get(resource) ?? []), action]);
  }
  return grouped;
}

/**
 * What the server refused, by the code its error carries. Both refusals are
 * 403s with one sentence, so only the code tells a role above its creator
 * ("choose a smaller one") from a viewer who may not create keys at all, as
 * when that permission is taken while the form is open.
 */
const REFUSAL_MESSAGES: ReadonlyMap<string, string> = new Map([
  [
    "API_KEY_ROLE_ABOVE_CREATOR",
    "You can't create a key with this role: it allows more than you can do.",
  ],
  ["FORBIDDEN", "You can no longer create API keys."],
]);

/**
 * The sentence shown instead of the list, or null when there is a list to
 * show. A refusal is the server saying no to this key or this viewer, not
 * failing to answer, and says which.
 */
function summaryMessage(state: {
  needsRole: boolean;
  error: Error | null;
  abilities: ApiKeyAbility[] | undefined;
}): string | null {
  if (state.needsRole) {
    return "Choose a role to see what this key will be able to do.";
  }
  if (state.error) {
    const code = "code" in state.error ? state.error.code : undefined;
    return (
      (typeof code === "string" ? REFUSAL_MESSAGES.get(code) : undefined) ??
      "What this key can do couldn't be loaded."
    );
  }
  if (state.abilities?.length === 0) {
    return "This key would be able to do nothing.";
  }
  return null;
}

export function KeySummary({
  tokenType,
  roleId,
}: KeySummaryProps): JSX.Element {
  const { data, error, isLoading } = useApiKeyAbilities({
    tokenType,
    ...(roleId ? { roleId } : {}),
  });
  const needsRole = tokenType === "role-based" && !roleId;

  if (!needsRole && isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Working out what this key can do…
      </div>
    );
  }

  const message = summaryMessage({ needsRole, error, abilities: data });
  if (message !== null || !data) {
    return <p className="text-sm text-muted-foreground">{message}</p>;
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2" data-testid="api-key-summary">
        {[...byResource(data).entries()].map(([resource, actions]) => (
          <li
            key={resource}
            data-resource={resource}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 text-sm"
          >
            <span className="min-w-32 font-medium text-foreground">
              {humaniseResource(resource)}
            </span>
            <span className="flex flex-wrap gap-1.5">
              {actions.map(action => (
                <span
                  key={action}
                  data-action={action}
                  className="inline-flex items-center rounded-sm border border-input bg-background px-2 py-0.5 text-xs font-medium text-foreground capitalize"
                >
                  {action}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {/* The list is the key's granted permissions. A collection's or Single's
        access rule written in code can still refuse a request, and may
        depend on the entry itself, so it cannot be listed ahead of time. */}
      <p className="text-xs text-muted-foreground">
        An access rule written in code for a collection or Single can still
        allow this key less.
      </p>
    </div>
  );
}
