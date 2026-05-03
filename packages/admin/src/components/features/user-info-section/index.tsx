"use client";

import { Avatar, AvatarFallback, Separator } from "@revnixhq/ui";

import { LogOut, User as UserIcon, HelpCircle } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { useLogout } from "@admin/hooks/useLogout";
import type { User } from "@admin/types/user";

interface UserInfoSectionProps {
  user: Partial<User> | null;
}

export const UserInfoSection: React.FC<UserInfoSectionProps> = ({ user }) => {
  const logout = useLogout();

  if (!user) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Loading user information...
      </div>
    );
  }

  return (
    <div>
      <div className="bg-card  border-t border-primary/5 px-4 py-6 animate-in fade-in-0 slide-in-from-bottom-2">
        <div className="flex flex-col items-center mb-3">
          <Avatar size="xl" className="bg-primary/5 mb-3 text-primary">
            <AvatarFallback>
              {user.name?.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="mt-2 text-sm font-medium text-card-foreground">
            {user.name}
          </span>
          <span className="mb-2 text-xs text-muted-foreground">
            {user.email}
          </span>
        </div>

        <Separator className="my-4 bg-border" />

        <div className="space-y-3">
          <Link
            href="/profile"
            className="flex w-full items-center space-x-2 rounded-none px-3 py-2 text-sm text-card-foreground hover:bg-accent cursor-pointer"
          >
            <UserIcon className="h-4 w-4 text-accent" />
            <div className="flex flex-col items-start">
              <span>Profile</span>
              <span className="text-xs text-muted-foreground">
                Manage your account
              </span>
            </div>
          </Link>

          <Link
            href="https://nextlyhq.com/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center space-x-2 rounded-none px-3 py-2 text-sm text-card-foreground hover:bg-accent cursor-pointer"
          >
            <HelpCircle className="h-4 w-4 text-primary" />
            <div className="flex flex-col items-start">
              <span>Help</span>
              <span className="text-xs text-muted-foreground">
                Documentation & support
              </span>
            </div>
          </Link>

          <button
            onClick={() => { void logout(); }}
            className="flex w-full items-center space-x-2 rounded-none px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 mt-2 cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            <div className="flex flex-col items-start">
              <span>Log out</span>
              <span className="text-xs text-red-400/80">End your session</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
