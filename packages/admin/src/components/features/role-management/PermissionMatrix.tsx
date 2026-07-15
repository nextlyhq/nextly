import {
  Button,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@nextlyhq/ui";

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
}: PermissionMatrixProps) {
  const {
    searchTerm,
    setSearchTerm,
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
  } = usePermissionMatrix({ permissions, value, onChange, lockedIds });

  return (
    <div className="flex flex-col">
      {/* Tabs and Search Row */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between mb-4 px-6">
          <TabsList>
            {PERMISSION_CATEGORIES.map(category => (
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
              onClick={() => onChange(permissions.map(p => p.id))}
              disabled={disabled || value.length === permissions.length}
              aria-label="Select all permissions"
            >
              Select All
            </Button>

            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => onChange([])}
              disabled={disabled || value.length === 0}
              aria-label="Clear all permissions"
            >
              Clear All
            </Button>
          </div>
        </div>

        {/* Tab Contents */}
        <div className="mt-4">
          {PERMISSION_CATEGORIES.map(category => (
            <TabsContent
              key={category}
              value={category}
              className="m-0 p-0 outline-none"
            >
              <PermissionMatrixTable
                contentTypes={filteredContentTypes[category] ?? []}
                value={value}
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
