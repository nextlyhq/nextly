"use client";

import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
} from "@revnixhq/ui";

import { ChevronUp, User, HelpCircle, LogOut } from "@admin/components/icons";
import { useLogout } from "@admin/hooks/useLogout";

interface SidebarUserFooterProps {
  /** User information to display */
  user: { name: string; email: string } | null;
  /** Whether sidebar is collapsed */
  collapsed: boolean;
  /** Whether user panel is open */
  isUserPanelOpen: boolean;
  /** Callback to toggle user panel */
  onTogglePanel: () => void;
}

/**
 * Sidebar user footer component
 *
 * Displays user information in sidebar footer with:
 * - User avatar, name, and email
 * - Dropdown menu with profile, help, and logout options
 * - Loading skeleton while fetching user data
 * - Collapsed/expanded states
 * - Tooltips for collapsed mode
 *
 * @example
 * ```tsx
 * <SidebarUserFooter
 *   user={user}
 *   collapsed={false}
 *   isUserPanelOpen={isOpen}
 *   onTogglePanel={() => setIsOpen(!isOpen)}
 * />
 * ```
 */
export function SidebarUserFooter({
  user,
  collapsed,
  _isUserPanelOpen,
  _onTogglePanel,
}: SidebarUserFooterProps) {
  const logout = useLogout();

  if (collapsed) {
    return (
      <div className="flex items-center justify-center py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="cursor-pointer focus:outline-none">
              <Avatar
                size="md"
                className="bg-primary/5 text-primary hover-unified transition-all"
              >
                <AvatarFallback>
                  {user?.name?.charAt(0)?.toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="end"
            className="w-56 bg-sidebar-background border-sidebar-border"
          >
            <div className="px-2 py-2">
              <p className="text-sm font-medium text-sidebar-foreground">
                {user?.name}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {user?.email}
              </p>
            </div>
            <DropdownMenuSeparator className="bg-sidebar-border/30" />
            <DropdownMenuItem
              asChild
              className="cursor-pointer rounded-none hover-unified focus:bg-primary/5 focus:text-primary"
            >
              <a href="/profile" className="flex items-center gap-2">
                <User className="h-4 w-4" />
                <span>Profile</span>
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem
              asChild
              className="cursor-pointer rounded-none hover-unified focus:bg-primary/5 focus:text-primary"
            >
              <a href="/help" className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4" />
                <span>Help</span>
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-sidebar-border/30" />
            <DropdownMenuItem
              onClick={() => {
                void logout();
              }}
              className="cursor-pointer rounded-none text-black hover-unified focus:bg-primary/5 focus:text-primary"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="w-full flex items-center gap-3 px-2 py-2 rounded-none hover-unified transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/50">
          {/* Avatar */}
          <Avatar size="md" className="bg-primary/5 text-primary">
            <AvatarFallback>
              {user?.name?.charAt(0)?.toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>

          {/* Name & Email */}
          {user ? (
            <div className="flex flex-col flex-1 min-w-0 text-left">
              <div className="text-sm font-medium text-sidebar-foreground truncate">
                {user.name ?? ""}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {user.email ?? ""}
              </div>
            </div>
          ) : (
            <div className="flex flex-col flex-1 min-w-0 space-y-1">
              <Skeleton className="h-4 w-24 bg-primary/5" />
              <Skeleton className="h-3 w-32 bg-primary/5" />
            </div>
          )}

          {/* Chevron */}
          <ChevronUp className="h-4 w-4 text-muted-foreground transition-transform duration-300 ease-out" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        className="w-56 bg-sidebar-background border-sidebar-border mb-2"
      >
        <div className="px-2 py-2">
          <p className="text-sm font-medium text-sidebar-foreground">
            {user?.name}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {user?.email}
          </p>
        </div>
        <DropdownMenuSeparator className="bg-sidebar-border/30" />
        <DropdownMenuItem
          asChild
          className="cursor-pointer rounded-none hover-unified focus:bg-primary/5 focus:text-primary"
        >
          <a href="/profile" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            <span>Profile</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem
          asChild
          className="cursor-pointer rounded-none hover-unified focus:bg-primary/5 focus:text-primary"
        >
          <a href="/help" className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4" />
            <span>Help</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-sidebar-border/30" />
        <DropdownMenuItem
          onClick={() => {
            void logout();
          }}
          className="cursor-pointer rounded-none text-black hover-unified focus:bg-primary/5 focus:text-primary"
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
