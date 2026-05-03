import {
  Button,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@revnixhq/ui";

import { Search } from "@admin/components/icons";
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
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center justify-between mb-4 px-6">
          <TabsList className="bg-transparent h-auto p-0 border-none space-x-2 auto-cols-auto">
            <TabsTrigger
              value="collection-types"
              className="rounded-none  border border-primary/5 border-transparent px-4 py-2 text-sm font-medium !mb-0 data-[state=active]:bg-primary/5 data-[state=active]:text-primary data-[state=active]:border-primary data-[state=inactive]:text-muted-foreground hover-unified hover:border-primary/25 transition-colors"
            >
              Collection Types
            </TabsTrigger>
            <TabsTrigger
              value="single-types"
              className="rounded-none  border border-primary/5 border-transparent px-4 py-2 text-sm font-medium !mb-0 data-[state=active]:bg-primary/5 data-[state=active]:text-primary data-[state=active]:border-primary data-[state=inactive]:text-muted-foreground hover-unified hover:border-primary/25 transition-colors"
            >
              Single Types
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="rounded-none  border border-primary/5 border-transparent px-4 py-2 text-sm font-medium !mb-0 data-[state=active]:bg-primary/5 data-[state=active]:text-primary data-[state=active]:border-primary data-[state=inactive]:text-muted-foreground hover-unified hover:border-primary/25 transition-colors"
            >
              Settings
            </TabsTrigger>
          </TabsList>

          {/* Search Bar and Action Buttons */}
          <div className="flex items-center gap-3">
            <div className="relative w-[220px]">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                className="pl-9"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                disabled={disabled}
                aria-label="Search content types"
              />
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange(permissions.map(p => p.id))}
              disabled={disabled || value.length === permissions.length}
              aria-label="Select all permissions"
              className="text-primary border-primary/5 bg-primary/5 hover-unified transition-colors"
            >
              Select All
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange([])}
              disabled={disabled || value.length === 0}
              aria-label="Clear all permissions"
              className="text-muted-foreground border-primary/5 hover-unified hover:text-foreground transition-colors"
            >
              Clear All
            </Button>
          </div>
        </div>

        {/* Tab Contents */}
        <div className="mt-4">
          <TabsContent
            value="collection-types"
            className="m-0 p-0 outline-none"
          >
            <PermissionMatrixTable
              contentTypes={filteredContentTypes["collection-types"]}
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

          <TabsContent value="single-types" className="m-0 p-0 outline-none">
            <PermissionMatrixTable
              contentTypes={filteredContentTypes["single-types"]}
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

          <TabsContent value="settings" className="m-0 p-0 outline-none">
            <PermissionMatrixTable
              contentTypes={filteredContentTypes["settings"]}
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
        </div>
      </Tabs>
    </div>
  );
}
