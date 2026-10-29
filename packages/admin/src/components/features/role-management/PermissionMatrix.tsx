import {
  Button,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@nextlyhq/ui";
import type { JSX } from "react";

import { Search } from "@admin/components/icons";
import {
  PERMISSION_CATEGORIES,
  PERMISSION_CATEGORY_LABELS,
} from "@admin/constants/permissions";
import { usePermissionMatrix } from "@admin/hooks/usePermissionMatrix";
import type { PermissionMatrixProps } from "@admin/types/ui/form";

import { PermissionMatrixTable } from "./PermissionMatrixTable";

export function PermissionMatrix({
  permissions,
  value = [],
  onChange,
  disabled = false,
  lockedIds = [],
}: PermissionMatrixProps): JSX.Element {
  const {
    searchTerm,
    setSearchTerm,
    organizedPermissions,
    activeTab,
    setActiveTab,
    filteredContentTypes,
    togglePermission,
    toggleAllForContentType,
    toggleAllForAction,
    isAllSelected,
    isPartiallySelected,
    isAllSelectedForAction,
    isPartiallySelectedForAction,
    shown,
  } = usePermissionMatrix({ permissions, value, onChange, lockedIds });

  // The grid may hold only some of the role's permissions, the rest being
  // set elsewhere on the screen, so it offers only the tabs it has something
  // in, as the hook groups them, and clearing takes away its own ids alone.
  // An empty grid keeps every tab, so each says it has nothing to show.
  const withContent = PERMISSION_CATEGORIES.filter(
    category => (organizedPermissions[category]?.length ?? 0) > 0
  );
  const tabs = withContent.length > 0 ? withContent : PERMISSION_CATEGORIES;
  const tab = tabs.find(category => category === activeTab) ?? tabs[0];
  const own = new Set(permissions.map(permission => permission.id));

  return (
    <div className="flex flex-col">
      {/* Tabs and Search Row */}
      <Tabs value={tab} onValueChange={setActiveTab} className="w-full">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between mb-4 px-6">
          <TabsList>
            {tabs.map(category => (
              <TabsTrigger key={category} value={category}>
                {PERMISSION_CATEGORY_LABELS[category]}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Search Bar and Action Buttons */}
          <div className="flex flex-1 lg:flex-none items-center gap-3 lg:justify-end min-w-0">
            <div className="relative flex-1 lg:w-64 lg:flex-none min-w-0">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                className="pl-9 w-full"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                disabled={disabled}
                aria-label="Search content types"
              />
            </div>

            <Button
              type="button"
              variant="outline"
              size="md"
              // Every permission the base does not already give, beside any
              // the role holds itself.
              onClick={() =>
                onChange(
                  Array.from(
                    new Set([
                      ...value,
                      ...permissions
                        .map(p => p.id)
                        .filter(id => !lockedIds.includes(id)),
                    ])
                  )
                )
              }
              disabled={
                disabled || permissions.every(p => shown.includes(p.id))
              }
              aria-label="Select all permissions"
            >
              Select All
            </Button>

            <Button
              type="button"
              variant="outline"
              size="md"
              // The value is the role's own permissions, so clearing takes the
              // grid's away; inherited ones stay shown, as the base gives them.
              onClick={() => onChange(value.filter(id => !own.has(id)))}
              disabled={disabled || !value.some(id => own.has(id))}
              aria-label="Clear all permissions"
            >
              Clear All
            </Button>
          </div>
        </div>

        {/* Tab Contents */}
        <div className="mt-4">
          {tabs.map(category => (
            <TabsContent
              key={category}
              value={category}
              className="m-0 p-0 outline-none"
            >
              <PermissionMatrixTable
                contentTypes={filteredContentTypes[category] ?? []}
                value={shown}
                lockedIds={lockedIds}
                disabled={disabled}
                searchTerm={searchTerm}
                onClearSearch={() => setSearchTerm("")}
                onTogglePermission={togglePermission}
                onToggleAllForContentType={toggleAllForContentType}
                onToggleAllForAction={toggleAllForAction}
                isAllSelected={isAllSelected}
                isPartiallySelected={isPartiallySelected}
                isAllSelectedForAction={isAllSelectedForAction}
                isPartiallySelectedForAction={isPartiallySelectedForAction}
              />
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}
