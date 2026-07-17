import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";

import { User as UserIcon, LogOut } from "@admin/components/icons";
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
            className="flex items-center justify-center h-11 w-11 rounded-none transition-all duration-200 cursor-pointer relative focus-visible:ring-2 focus-visible:ring-primary focus:outline-none hover-subtle-row group"
            aria-label="User profile menu"
          >
            <Avatar className="h-11 w-11 rounded-none bg-primary/5  border border-border group-hover:border-border transition-colors">
              <AvatarImage
                src={user?.avatar}
                alt={user?.name || "User"}
                className="rounded-none"
              />
              <AvatarFallback className="bg-transparent text-sidebar-foreground text-xs font-bold rounded-none">
                {user?.name?.charAt(0)?.toUpperCase() || "U"}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-64 p-2 mb-2 ml-2 rounded-none shadow-xl shadow-black/5 admin-dropdown-content border border-border bg-popover"
          side="bottom"
          align="end"
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
          {/* Muted foreground so this menu label meets contrast; a faint primary alpha did not. */}
          <DropdownMenuItem
            onClick={() => {
              if (!user?.id) return;
              navigateTo(buildRoute(ROUTES.USERS_EDIT, { id: user.id }));
            }}
            className="group flex w-full cursor-pointer items-center gap-3 rounded-none px-3 py-2.5 text-[13px] font-medium transition-colors hover-subtle-row text-muted-foreground"
          >
            <UserIcon className="h-4 w-4 transition-colors" />
            <span>My Account</span>
          </DropdownMenuItem>

          {/* Muted foreground so this menu label meets contrast; a faint primary alpha did not. */}
          <DropdownMenuItem
            onClick={onLogout}
            className="group flex w-full cursor-pointer items-center gap-3 rounded-none px-3 py-2.5 text-[13px] font-medium transition-colors hover-subtle-row text-muted-foreground"
          >
            <LogOut className="h-4 w-4 transition-colors" />
            <span>Sign out</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
