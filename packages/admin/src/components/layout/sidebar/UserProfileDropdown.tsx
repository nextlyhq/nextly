import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import type { JSX } from "react";

import {
  Discord,
  ExternalLink,
  Github,
  HelpCircle,
  User as UserIcon,
  LogOut,
} from "@admin/components/icons";
import { ThemeChoice } from "@admin/components/shared/theme-toggle";
import { ROUTES } from "@admin/constants/routes";
import {
  useSetInterfaceLanguage,
  useStoredInterfaceLanguage,
} from "@admin/hooks/useInterfaceLanguage";
import { useInterfaceLanguages, useT } from "@admin/lib/i18n/I18nProvider";
import { languageName } from "@admin/lib/i18n/language-name";
import { navigateTo } from "@admin/lib/navigation";

import type { PluginUserMenuEntry } from "../header/header-visibility";

import {
  PluginMenuActionDialog,
  PluginUserMenuItems,
  usePluginMenuAction,
} from "./plugin-user-menu";

interface UserProfileDropdownProps {
  user: {
    id?: string;
    name?: string;
    email?: string;
    avatar?: string;
  } | null;
  onLogout: () => void;
  className?: string;
  /**
   * The help links a plugin has hidden (`header.hide` / `hideDefaults`), read
   * by the same rule that hid them from the top bar.
   */
  hidden?: ReadonlySet<"github" | "discord" | "docs" | "notifications">;
  /**
   * The items plugins put in this menu (`header.place: "menu"`), in order,
   * drawn after the help links.
   */
  pluginItems?: readonly PluginUserMenuEntry[];
  /** Where the menu opens from its trigger: to the right of the rail. */
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

/** The help and community links, each hideable by a plugin. */
const HELP_LINKS = [
  {
    id: "docs",
    label: "Documentation",
    href: "https://nextlyhq.com/docs",
    icon: HelpCircle,
  },
  {
    id: "github",
    label: "GitHub",
    href: "https://github.com/nextlyhq/nextly",
    icon: Github,
  },
  {
    id: "discord",
    label: "Discord",
    href: "https://discord.gg/hJUg9AZMn",
    icon: Discord,
  },
] as const;

/**
 * Documentation, GitHub and Discord, as one group, and the items plugins put
 * there after them.
 * They lived as icons across the top bar on every page; here they are a click
 * away without taking the bar's width from the page.
 */
function HelpAndCommunity({
  hidden,
  pluginItems,
  onPluginAction,
}: {
  hidden: ReadonlySet<string>;
  pluginItems: readonly PluginUserMenuEntry[];
  onPluginAction: (item: PluginUserMenuEntry) => void;
}): JSX.Element | null {
  const links = HELP_LINKS.filter(link => !hidden.has(link.id));
  // Drawn while it has something to show: a help link left, or a plugin's item.
  if (links.length === 0 && pluginItems.length === 0) return null;
  return (
    <>
      <DropdownMenuLabel className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
        Help and community
      </DropdownMenuLabel>
      {links.map(({ id, label, href, icon: Icon }) => (
        <DropdownMenuItem key={id} asChild className="cursor-pointer text-sm">
          <a href={href} target="_blank" rel="noopener noreferrer">
            <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
            {label}
            <ExternalLink
              className="ml-auto h-3.5 w-3.5 text-muted-foreground"
              aria-hidden="true"
            />
          </a>
        </DropdownMenuItem>
      ))}
      <PluginUserMenuItems items={pluginItems} onAction={onPluginAction} />
      <DropdownMenuSeparator className="my-1" />
    </>
  );
}

/** The radio value standing for "no choice stored": follow the browser. */
const FOLLOW_BROWSER = "";

/**
 * The person's own interface language: follow the browser, or one of the
 * languages the admin has a catalog for, each named in itself. Saved through
 * their own profile, the one place it is set.
 */
function InterfaceLanguageChoice(): JSX.Element {
  const t = useT();
  const languages = useInterfaceLanguages();
  const stored = useStoredInterfaceLanguage(true);
  const setInterfaceLanguage = useSetInterfaceLanguage();
  // A stored language the admin has no catalog for (its plugin removed, say)
  // is still shown, chosen and marked, so the person sees what is stored
  // while the admin falls back, and that it returns with its catalog.
  const unavailable =
    stored != null && !languages.includes(stored) ? stored : null;
  return (
    <>
      <DropdownMenuLabel className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
        {t("nextly.userMenu.interfaceLanguage")}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={stored ?? FOLLOW_BROWSER}
        onValueChange={value =>
          setInterfaceLanguage(value === FOLLOW_BROWSER ? null : value)
        }
      >
        <DropdownMenuRadioItem
          value={FOLLOW_BROWSER}
          className="cursor-pointer text-sm"
        >
          {t("nextly.userMenu.followBrowser")}
        </DropdownMenuRadioItem>
        {unavailable !== null && (
          <DropdownMenuRadioItem
            value={unavailable}
            lang={unavailable}
            className="cursor-pointer text-sm text-muted-foreground"
          >
            {t("nextly.userMenu.unavailable", {
              language: languageName(unavailable),
            })}
          </DropdownMenuRadioItem>
        )}
        {languages.map(language => (
          <DropdownMenuRadioItem
            key={language}
            value={language}
            lang={language}
            className="cursor-pointer text-sm"
          >
            {languageName(language)}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator className="my-1" />
    </>
  );
}

export function UserProfileDropdown({
  user,
  onLogout,
  className,
  hidden = new Set(),
  pluginItems = [],
  side = "bottom",
  align = "end",
}: UserProfileDropdownProps): JSX.Element {
  // Held here, outside the menu, so what an item opened outlives the menu
  // closing on the choice.
  const pluginAction = usePluginMenuAction();
  return (
    <div className={className}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center justify-center h-11 w-11 rounded-md transition-all duration-200 cursor-pointer relative focus-visible:ring-2 focus-visible:ring-primary focus:outline-none hover-subtle-row group"
            aria-label="User profile menu"
          >
            <Avatar className="h-11 w-11 bg-primary/5  border border-border group-hover:border-border transition-colors">
              <AvatarImage src={user?.avatar} alt={user?.name || "User"} />
              <AvatarFallback className="bg-transparent text-sidebar-foreground text-xs font-bold">
                {user?.name?.charAt(0)?.toUpperCase() || "U"}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-64 p-2 mb-2 ml-2 rounded-lg shadow-xl shadow-(color:--nx-shadow-color)/5 admin-dropdown-content border border-border bg-popover"
          side={side}
          align={align}
          forceMount
        >
          {/* User identity block */}
          <div className="px-3 py-2.5 mb-1  border-b border-border">
            <p className="text-sm font-semibold text-foreground leading-tight truncate">
              {user?.name || "Super Admin"}
            </p>
            {/* Only render the email line when the user actually has one;
                no hardcoded placeholder address as a fallback. */}
            {user?.email && (
              <p className="text-xs text-muted-foreground leading-tight truncate mt-0.5">
                {user.email}
              </p>
            )}
          </div>
          <InterfaceLanguageChoice />
          <ThemeChoice />
          <DropdownMenuSeparator className="my-1" />
          <HelpAndCommunity
            hidden={hidden}
            pluginItems={pluginItems}
            onPluginAction={item => {
              void pluginAction.run(item);
            }}
          />
          {/* Muted foreground so this menu label meets contrast; a faint primary alpha did not. */}
          <DropdownMenuItem
            // The signed-in person's own page, which every one of them may
            // open: the users edit page needs a permission many lack.
            onClick={() => navigateTo(ROUTES.ACCOUNT)}
            className="group flex w-full cursor-pointer items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-medium transition-colors hover-subtle-row text-muted-foreground"
          >
            <UserIcon className="h-4 w-4 transition-colors" />
            <span>My Account</span>
          </DropdownMenuItem>

          {/* Muted foreground so this menu label meets contrast; a faint primary alpha did not. */}
          <DropdownMenuItem
            onClick={onLogout}
            className="group flex w-full cursor-pointer items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-medium transition-colors hover-subtle-row text-muted-foreground"
          >
            <LogOut className="h-4 w-4 transition-colors" />
            <span>Sign out</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PluginMenuActionDialog
        opened={pluginAction.opened}
        close={pluginAction.close}
      />
    </div>
  );
}
