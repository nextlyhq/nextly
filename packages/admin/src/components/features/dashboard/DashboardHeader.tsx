import React from "react";

import { AlignLeft } from "@admin/components/icons";
import { useSidebar } from "@admin/components/layout/sidebar";

interface DashboardHeaderProps {
  user: { id: string; name: string; email: string; avatar?: string } | null;
}

export function DashboardHeader() {
  const { toggleSidebar } = useSidebar();

  return (
    // In DashboardHeader.tsx
    <header className="sticky top-0 z-30 shrink-0 hidden md:flex h-16 items-center justify-end border-b border-border/40 bg-background backdrop-blur-md px-4 sm:px-8">
      {/* Left Section: Sidebar Toggle */}
      <div className="flex items-center gap-2 hidden">
        <button
          onClick={toggleSidebar}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/40 bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
          aria-label="Toggle Sidebar"
        >
          <AlignLeft className="h-4 w-4" />
        </button>
      </div>

      {/* Right Section: Help, etc. */}
      <div className="flex items-center gap-2 justify-end">
        {/* Potentially add search or other top-level actions here if needed */}
      </div>
    </header>
  );
}
