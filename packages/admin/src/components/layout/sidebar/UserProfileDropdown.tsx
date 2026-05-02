import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@revnixhq/ui";

import { User as UserIcon, HelpCircle, LogOut } from "@admin/components/icons";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { navigateTo } from "@admin/lib/navigation";

interface UserProfileDropdownProps {
  user: {
    id?: string;
    name?: string;
    email?: string;
    avatar?: string;
  } | null;
  onLogout: () => void;
  className?: string;
}

export function UserProfileDropdown({
  user,
  onLogout,
  className,
}: UserProfileDropdownProps) {
  return (
    <div className={className}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center justify-center h-11 w-11 rounded-none transition-all duration-200 cursor-pointer relative focus-visible:ring-2 focus-visible:ring-primary/20 focus:outline-none hover-subtle-row group"
            aria-label="User profile menu"
          >
            <Avatar className="h-8 w-8 rounded-none border border-sidebar-border group-hover:border-primary/20 transition-colors">
              <AvatarImage
                src={user?.avatar}
                alt={user?.name || "User"}
                className="rounded-none"
              />
              <AvatarFallback className="bg-transparent text-sidebar-foreground/50 text-xs font-bold rounded-none">
                {user?.name?.charAt(0)?.toUpperCase() || "U"}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-64 p-2 mb-2 ml-2 rounded-none border-sidebar-border shadow-xl shadow-black/5 admin-dropdown-content border bg-sidebar"
          side="bottom"
          align="end"
          forceMount
        >
          {/* User identity block */}
          <div className="px-3 py-2.5 mb-1 border-b border-border/50">
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
            }}
            className="group flex w-full items-center gap-3 rounded-none px-3 py-2.5 text-[13px] font-medium transition-colors cursor-pointer hover-subtle-row"
          >
            <UserIcon className="h-4 w-4 text-muted-foreground/70 group-hover-subtle-row transition-colors" />
            <span>My Account</span>
          </DropdownMenuItem>

          <DropdownMenuItem className="group flex w-full items-center p-0 rounded-none text-[13px] font-medium transition-colors hover-subtle-row">
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

          <div className="pt-2 mt-2 border-t border-border/50">
            <DropdownMenuItem
              onClick={onLogout}
              className="group flex w-full cursor-pointer items-center gap-3 rounded-none px-3 py-2.5 text-[13px] font-medium transition-colors hover-subtle-row"
            >
              <LogOut className="h-4 w-4 transform transition-transform group-hover-subtle-row group-hover:-translate-x-0.5" />
              <span>Sign out</span>
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
