import { Badge } from "@nextlyhq/ui";
import type React from "react";

import { PluginIconFrom } from "@admin/components/shared/plugin-icon";
import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { categoryLabel } from "@admin/lib/plugins/plugin-categories";
import { pluginSlug } from "@admin/lib/plugins/plugin-slug";
import {
  cataloguePresentationCandidates,
  resolveCataloguePresentation,
} from "@admin/lib/plugins/registry/resolve-catalogue-presentation";
import type { RegistryPlugin } from "@admin/lib/plugins/registry/types";
import type { PluginMetadata } from "@admin/types/branding";

interface PluginCardProps {
  plugin: RegistryPlugin;
  /**
   * The installed plugin this entry describes, when the project has it.
   *
   * The metadata itself rather than a boolean: an installed plugin is the
   * authority on its own icon and description, so the card needs what it
   * declared and not merely the fact that it exists.
   */
  installed: Pick<PluginMetadata, "appearance" | "description"> | undefined;
}

/**
 * One plugin in the directory grid.
 *
 * A link rather than a card with a button inside it: the whole card is one
 * destination, so making the card the anchor gives a keyboard user one stop
 * instead of a container they must enter to find the real control.
 *
 * @module pages/dashboard/plugins/components/PluginCard
 */
export function PluginCard({
  plugin,
  installed,
}: PluginCardProps): React.ReactElement {
  const presentation = resolveCataloguePresentation(plugin, installed);
  const label = categoryLabel(plugin.category);

  return (
    <Link
      href={buildRoute(ROUTES.PLUGIN_DETAIL, { slug: pluginSlug(plugin.id) })}
      className="group flex h-full flex-col gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
          <PluginIconFrom
            candidates={cataloguePresentationCandidates(plugin, installed)}
            fallback="Package"
            className="h-4.5 w-4.5 text-muted-foreground"
          />
        </span>

        <div className="min-w-0 flex-1">
          {/* `truncate` needs the min-w-0 above: a flex child defaults to
              min-width:auto, which refuses to shrink below its content. */}
          <h3 className="truncate text-sm font-semibold">{plugin.name}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {plugin.author}
          </p>
        </div>

        {presentation.isInstalled && (
          <Badge
            variant="success"
            data-testid={`installed-${plugin.id}`}
            className="shrink-0"
          >
            Installed
          </Badge>
        )}
      </div>

      {/* Two lines, not a character count: a clamp adapts to the card's real
          width, where a truncated string would cut at a different place on
          every breakpoint. */}
      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {presentation.description}
      </p>

      {label && (
        <span className="mt-auto text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      )}
    </Link>
  );
}
