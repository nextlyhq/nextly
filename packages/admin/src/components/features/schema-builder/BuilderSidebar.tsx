import { Tabs, TabsContent, TabsList, TabsTrigger } from "@revnixhq/ui";
import React, { useRef, useEffect } from "react";

import * as Icons from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

interface BuilderSidebarProps {
  palette: React.ReactNode;
  settings?: React.ReactNode;
  editor: React.ReactNode;
  header?: React.ReactNode;
  activeTab: string;
  onTabChange: (tab: string) => void;
  className?: string;
  isSticky?: boolean;
}

export function BuilderSidebar({
  palette,
  settings,
  editor,
  header,
  activeTab,
  onTabChange,
  className,
  isSticky = false,
}: BuilderSidebarProps) {
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logic for mobile
  useEffect(() => {
    if (
      !activeTab ||
      typeof window === "undefined" ||
      window.innerWidth >= 1024
    )
      return;

    // Smooth scroll the sidebar into view when a tab/panel is activated
    const timer = setTimeout(() => {
      sidebarRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 100); // Small delay to ensure content is rendered

    return () => clearTimeout(timer);
  }, [activeTab]);
  // Tab config - Reordered and Properties button removed
  const tabs = [
    ...(settings
      ? [
          {
            value: "settings",
            label: "Settings",
            icon: <Icons.Settings className="h-3 w-3 shrink-0" />,
          },
        ]
      : []),
    {
      value: "add",
      label: "Add Fields",
      icon: <Icons.Plus className="h-3 w-3 shrink-0" />,
    },
  ];

  const colsClass = tabs.length === 2 ? "grid-cols-2" : "grid-cols-1";

  // Safety: If activeTab is 'edit' but no editor is active or we're in a middle state,
  // ensure the underlying Tabs component doesn't show a blank state by defaulting to 'add'.
  const tabsValue = activeTab === "edit" ? "add" : activeTab;

  return (
    <div
      ref={sidebarRef}
      className={cn(
        "h-auto lg:h-full flex flex-col bg-background lg:border-l border-border relative",
        className
      )}
    >
      {/* Properties Panel Overlay - absolute positioning to cover the whole sidebar */}
      {activeTab === "edit" && (
        <div className="absolute inset-0 z-50 bg-background animate-in slide-in-from-right duration-200">
          {editor}
        </div>
      )}

      {header && (
        <div className="p-4 border-b border-border bg-background">{header}</div>
      )}

      <Tabs
        value={tabsValue}
        onValueChange={onTabChange}
        className="flex-1 flex flex-col lg:flex-col-reverse w-full"
      >
        {/* Tab content panels - Only show if a tab is active */}
        {tabsValue && (
          <div className="flex-1 min-h-[400px] lg:min-h-0 relative">
            {/* Mobile Close Button - Half-circle floating at top center */}
            <button
              type="button"
              onClick={() => onTabChange("")}
              className="lg:hidden absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full z-[60] flex items-end justify-center w-12 h-6 rounded-t-xl bg-background border border-b-0 border-border shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] text-muted-foreground hover:text-foreground transition-all duration-200"
              aria-label="Close panel"
            >
              <Icons.X className="h-4 w-4 mb-0.5" />
            </button>

            <TabsContent
              value="add"
              className="absolute inset-0 m-0 h-full overflow-hidden flex flex-col data-[state=inactive]:hidden"
            >
              {palette}
            </TabsContent>
            <TabsContent
              value="settings"
              className="absolute inset-0 m-0 h-full overflow-y-auto data-[state=inactive]:hidden"
            >
              <div className="p-4 space-y-6">{settings}</div>
            </TabsContent>
          </div>
        )}

        {/* Tab bar - Bottom on mobile, Top on desktop */}
        <TabsList
          className={cn(
            `shrink-0 grid ${colsClass} gap-0 px-0 py-0 border-t lg:border-t-0 lg:border-b border-border bg-background h-auto w-full rounded-none`,
            isSticky &&
              "fixed bottom-0 left-0 right-0 z-[60] lg:static lg:border-t-0"
          )}
        >
          {tabs.map(tab => {
            const isActive = tabsValue === tab.value;
            return (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                onClick={(e: React.MouseEvent) => {
                  if (isActive && window.innerWidth < 1024) {
                    e.preventDefault();
                    onTabChange("");
                  }
                }}
                className={cn(
                  "flex items-center justify-center gap-1.5 w-full text-[13px] font-medium transition-all duration-150 border-0 shadow-none! h-full py-3 rounded-none",
                  isActive
                    ? "bg-primary !text-primary-foreground border-primary"
                    : "bg-transparent text-muted-foreground hover:text-foreground hover-subtle-row"
                )}
                style={{
                  borderColor: isActive ? "hsl(var(--primary))" : undefined,
                  borderWidth: isActive ? "1px" : "0px",
                }}
              >
                {tab.icon}
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {/* Spacer for sticky buttons on mobile */}
        {isSticky && (
          <div
            className="h-[60px] w-full shrink-0 lg:hidden"
            aria-hidden="true"
          />
        )}
      </Tabs>
    </div>
  );
}
