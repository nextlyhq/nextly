import { NotificationBell } from "@admin/components/features/notifications";
import { Github, HelpCircle } from "@admin/components/icons";
import { useDashboardUser } from "@admin/hooks/useDashboardUser";
import { useLogout } from "@admin/hooks/useLogout";
import { cn } from "@admin/lib/utils";

import { UserProfileDropdown } from "../sidebar/UserProfileDropdown";

interface DashboardHeaderProps {
  className?: string;
}

export function DashboardHeader({ className }: DashboardHeaderProps) {
  const { user } = useDashboardUser();
  const logout = useLogout();

  return (
    <header
      className={cn(
        "h-16 border-b border-primary/5 bg-background/80 backdrop-blur-md sticky top-0 z-40 w-full",
        "flex items-center justify-between px-6",
        className
      )}
    >
      <div className="flex items-center gap-4">
        {/* Placeholder for breadcrumbs or page title if needed in future */}
      </div>

      <div className="flex items-center gap-1">
        <a
          href="https://github.com/nextlyhq/nextly"
          target="_blank"
          rel="noopener noreferrer"
          className="relative flex items-center justify-center h-11 w-11 rounded-none transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 hover-subtle-row group"
          title="GitHub Repository"
        >
          <Github className="h-5 w-5 text-primary/50 group-hover:text-primary transition-colors" />
          <span className="absolute top-2.5 right-2.5 h-2 w-2 rounded-full bg-primary border-2 border-background" />
        </a>

        <a
          href="https://nextlyhq.com/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center h-11 w-11 rounded-none transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 hover-subtle-row group"
          title="Documentation"
        >
          <HelpCircle className="h-5 w-5 text-primary/50 group-hover:text-primary transition-colors" />
        </a>

        {/* F10 PR 5: bell renders only for super-admins (component
            self-gates via useCurrentUserPermissions). */}
        <NotificationBell />
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
