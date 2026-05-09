import type { EnabledHook } from "@admin/components/features/schema-builder";
import { getPrebuiltHook } from "@admin/components/features/schema-builder";
import type { StoredHookConfig } from "@admin/types/collection";

/**
 * Convert UI EnabledHook[] to API StoredHookConfig[] format.
 * Looks up the hookType from the prebuilt hook registry and adds order.
 */
export function convertHooksToStoredFormat(
  hooks: EnabledHook[]
): StoredHookConfig[] {
  return hooks
    .map((hook, index) => {
      const prebuiltHook = getPrebuiltHook(hook.hookId);
      if (!prebuiltHook) {
        console.warn(`Unknown hook ID: ${hook.hookId}`);
        return null;
      }
      return {
        hookId: hook.hookId,
        hookType: prebuiltHook.hookType as StoredHookConfig["hookType"],
        enabled: hook.enabled,
        config: hook.config,
        order: index,
      };
    })
    .filter((hook): hook is NonNullable<typeof hook> => hook !== null);
}
