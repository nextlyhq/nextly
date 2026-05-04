"use client";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@revnixhq/ui";
import React from "react";

import {
  LogOut,
  User as UserIcon,
  Menu,
  HelpCircle,
} from "@admin/components/icons";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useLogout } from "@admin/hooks/useLogout";
import { navigateTo } from "@admin/lib/navigation";

interface ResponsiveHeaderProps {
  /** Callback when hamburger menu is clicked */
  onMenuClick: () => void;
  /** Current user information */
  user: { id: string; name: string; email: string; avatar?: string } | null;
}

/**
 * Responsive Header Component
 *
 * Provides a sticky header with hamburger menu button for mobile navigation.
 */
export function ResponsiveHeader({ onMenuClick, user }: ResponsiveHeaderProps) {
  const logout = useLogout();
  const [activeMenu, setActiveMenu] = React.useState<"user" | null>(null);

  return (
    <header className="sticky top-0 z-50 w-full  border-b border-primary/5 bg-background/80 backdrop-blur-md">
      <div className="flex h-16 items-center justify-between px-4">
        {/* Left: Hamburger Menu (Mobile Only) */}
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 text-muted-foreground hover:text-foreground active:scale-95 transition-all duration-200"
          onClick={onMenuClick}
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Right: User Account Dropdown */}
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu
            open={activeMenu === "user"}
            onOpenChange={open => setActiveMenu(open ? "user" : null)}
          >
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="group inline-flex items-center justify-center h-9 w-9 p-0 rounded-none text-muted-foreground  border border-primary/5 border-transparent hover-subtle-row transition-all duration-200 outline-none focus-visible:bg-background focus-visible:!border-primary focus-visible:ring-1 focus-visible:!ring-primary/20 cursor-pointer relative"
              >
                <Avatar className="h-full w-full bg-transparent rounded-none transition-all duration-200">
                  <AvatarImage
                    src={user?.avatar}
                    alt={user?.name || "User"}
                    className="rounded-none"
                  />
                  <AvatarFallback className="bg-transparent text-current text-sm font-bold rounded-none">
                    {user?.name?.charAt(0)?.toUpperCase() || "U"}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-64 p-2 mt-2 rounded-none border-primary/5 shadow-xl shadow-black/5 admin-dropdown-content"
              align="end"
              forceMount
            >
              {/* User identity block */}
              <div className="px-3 py-2.5 mb-1  border-b border-primary/5">
                <p className="text-sm font-semibold text-foreground leading-tight truncate">
                  {user?.name || "Super Admin"}
                </p>
                <p className="text-xs text-muted-foreground leading-tight truncate mt-0.5">
                  {user?.email || "admin@example.com"}
                </p>
              </div>
              <DropdownMenuItem
                onClick={() => {
                  if (!user?.id) return;
                  navigateTo(buildRoute(ROUTES.USERS_EDIT, { id: user.id }));
                  setActiveMenu(null);
                }}
                className="group flex w-full items-center gap-3 rounded-none px-3 py-2.5 text-[13px] font-medium transition-colors cursor-pointer hover-subtle-row"
              >
                <UserIcon className="h-4 w-4 text-muted-foreground/70 group-hover-subtle-row transition-colors" />
                <span>My Account</span>
              </DropdownMenuItem>

              <DropdownMenuItem className="group flex w-full items-center p-0 rounded-none text-[13px] font-medium transition-colors admin-dropdown-item hover-subtle-row">
                <a
                  href="https://nextlyhq.com/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center gap-3 px-3 py-2.5"
                >
                  <HelpCircle className="h-4 w-4 text-muted-foreground/70 group-hover-subtle-row transition-colors" />
                  <span>Documentation</span>
                </a>
              </DropdownMenuItem>

              <div className="pt-2 mt-2  border-t border-primary/5">
                <DropdownMenuItem
                  onClick={() => { void logout(); }}
                  className="group flex w-full cursor-pointer items-center gap-3 rounded-none px-3 py-2.5 text-[13px] font-medium transition-colors hover-subtle-row"
                >
                  <LogOut className="h-4 w-4 transform transition-transform group-hover-subtle-row group-hover:-translate-x-0.5" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
