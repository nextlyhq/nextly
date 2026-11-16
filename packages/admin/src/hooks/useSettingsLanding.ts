/**
 * Where a link to "Settings" sends the current reader: the first destination
 * in the Settings panel they can open.
 *
 * For the breadcrumbs of pages inside the panel. `/admin/settings` itself is
 * General Settings, which answers to `read-settings`, so a crumb pointing
 * there turns away a reader whose only destination is further in, such as
 * someone who may only see Email. Asked of the same resolver the rail's
 * Settings entry uses, so the crumb and the rail cannot disagree.
 *
 * @module hooks/useSettingsLanding
 */
import {
  canAccessApiKeys,
  canAccessWebhooks,
} from "@admin/components/layout/sidebar/lib/has-settings-section";
import { resolveSettingsLanding } from "@admin/components/layout/sidebar/lib/resolve-settings-landing";

import { useCurrentUserPermissions } from "./useCurrentUserPermissions";

export function useSettingsLanding(): string {
  const { hasPermission } = useCurrentUserPermissions();
  return resolveSettingsLanding({
    hasPermission,
    canAccessApiKeys: canAccessApiKeys(hasPermission),
    canAccessWebhooks: canAccessWebhooks(hasPermission),
  });
}
