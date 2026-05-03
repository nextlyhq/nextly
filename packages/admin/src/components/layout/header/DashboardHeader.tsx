import { NotificationBell } from "@admin/components/features/notifications";
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
        "h-16  border-b border-primary/5 bg-background/80 backdrop-blur-md sticky top-0 z-40 w-full",
        "flex items-center justify-between px-6",
        className
      )}
    >
      <div className="flex items-center gap-4">
        {/* Placeholder for breadcrumbs or page title if needed in future */}
      </div>

      <div className="flex items-center gap-4">
        {/* F10 PR 5: bell renders only for super-admins (component
            self-gates via useCurrentUserPermissions). */}
        <NotificationBell />
        <UserProfileDropdown
          user={user}
          onLogout={() => {
            void logout();
          }}
        />
      </div>
    </header>
  );
}
