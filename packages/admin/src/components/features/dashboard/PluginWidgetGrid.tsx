"use client";

import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { cn } from "@admin/lib/utils";

/**
 * Renders plugin-contributed dashboard widgets (D22 / C9). Collects every
 * enabled plugin's `widgets`, RBAC-gates each via `useCurrentUserPermissions`
 * (closed-until-loaded — the `useCan` semantics, D36), and renders each through
 * `PluginSlot` (resolution + error isolation, D53) in a 12-column grid where
 * `half` widgets span 6 and `full` (default) span 12.
 */
export function PluginWidgetGrid() {
  const branding = useBranding();
  const { hasPermission } = useCurrentUserPermissions();

  const widgets = (branding?.plugins ?? []).flatMap(p => p.widgets ?? []);
  const visible = widgets.filter(
    w => !w.requiredPermission || hasPermission(w.requiredPermission)
  );

  if (visible.length === 0) return null;

  return (
    <div className="grid grid-cols-12 gap-6">
      {visible.map(w => (
        <div
          key={w.id}
          className={cn(w.size === "half" ? "col-span-6" : "col-span-12")}
        >
          <PluginSlot path={w.component} props={{ widgetId: w.id }} />
        </div>
      ))}
    </div>
  );
}
