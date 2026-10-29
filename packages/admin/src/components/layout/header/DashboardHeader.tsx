import type { JSX } from "react";

import { NotificationBell } from "@admin/components/features/notifications";
import { Discord, Github, HelpCircle } from "@admin/components/icons";
import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { ThemeToggle } from "@admin/components/shared/theme-toggle";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useDashboardUser } from "@admin/hooks/useDashboardUser";
import { useLogout } from "@admin/hooks/useLogout";
import { cn } from "@admin/lib/utils";

import { UserProfileDropdown } from "../sidebar/UserProfileDropdown";

import { computeHiddenHeaderButtons } from "./header-visibility";
import { HeaderTrail } from "./HeaderTrail";

interface DashboardHeaderProps {
  className?: string;
}

export function DashboardHeader({
  className,
}: DashboardHeaderProps): JSX.Element {
  const { user } = useDashboardUser();
  const logout = useLogout();
  const branding = useBranding();
  const hidden = computeHiddenHeaderButtons(branding?.plugins);
  // Plugin-contributed header-slot components; each self-gates on
  // permission. Read `header.slot` (current) with `headerSlot` (deprecated)
  // fallback.
  const headerSlots = (branding?.plugins ?? [])
    .map(p => ({ name: p.name, slot: p.header?.slot ?? p.headerSlot }))
    .filter((p): p is { name: string; slot: string } => Boolean(p.slot));

  return (
    <header
      className={cn(
        "h-16 border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40 w-full",
        "flex items-center justify-between gap-4 px-6",
        // A container, so the trail on the left answers to the bar's own
        // width: a sidebar narrows it as much as a small window does.
        "@container/topbar",
        className
      )}
    >
      {/* The trail the page on screen registered, such as an open document's
          place under Content. It may shrink and truncate; the controls on the
          right keep their size. */}
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <HeaderTrail />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {!hidden.has("github") && (
          <a
            href="https://github.com/nextlyhq/nextly"
            target="_blank"
            rel="noopener noreferrer"
            className="relative flex items-center justify-center h-11 w-11 rounded-md transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary hover-subtle-row group"
            title="GitHub Repository"
          >
            {/* Muted foreground so this resting icon meets contrast; it brightens to the
                foreground ink on hover, not to the action token. */}
            <Github className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
            <span className="absolute top-2.5 right-2.5 h-2 w-2 rounded-full bg-primary border-2 border-background" />
          </a>
        )}
        {!hidden.has("discord") && (
          <a
            href="https://discord.gg/hJUg9AZMn"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center h-11 w-11 rounded-md transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary hover-subtle-row group"
            title="Discord Community"
          >
            {/* Muted foreground so this resting icon meets contrast; it brightens to the
                foreground ink on hover, not to the action token. */}
            <Discord className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
          </a>
        )}

        {!hidden.has("docs") && (
          <a
            href="https://nextlyhq.com/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center h-11 w-11 rounded-md transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary hover-subtle-row group"
            title="Documentation"
          >
            {/* Muted foreground so this resting icon meets contrast; it brightens to the
                foreground ink on hover, not to the action token. */}
            <HelpCircle className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
          </a>
        )}

        {/* Plugin header-slot components, rendered before the bell. */}
        {headerSlots.map(p => (
          <PluginSlot key={p.name} path={p.slot} />
        ))}

        <ThemeToggle />

        {/* Bell renders only for super-admins (self-gated via
            useCurrentUserPermissions), and only where the builder runs: the
            dropdown lists schema changes, which are journaled by the builder
            and the dev-time code-first push. Elsewhere the schema arrives
            through committed migrations, which write no journal, so the
            dropdown would have nothing to list. Gated on an explicit `false`
            so the in-flight `undefined` does not hide it mid-load. */}
        {!hidden.has("notifications") && branding?.showBuilder !== false && (
          <NotificationBell />
        )}
        <div className="ml-2">
          <UserProfileDropdown
            user={user}
            onLogout={() => {
              void logout();
            }}
          />
        </div>
      </div>
    </header>
  );
}
