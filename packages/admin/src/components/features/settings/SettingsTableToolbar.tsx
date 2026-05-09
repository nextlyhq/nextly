import type { ReactNode } from "react";

interface SettingsTableToolbarProps {
  /** Left-anchored search bar; usually a <SearchBar> instance. */
  search: ReactNode;
  /** Right-side filter slot (filter dropdowns, status pills, etc.). Optional. */
  filters?: ReactNode;
  /** Right-side columns toggle (a DropdownMenu). Optional. */
  columns?: ReactNode;
}

/**
 * Toolbar above list-page tables.
 * Layout: [search.................] [filters] [columns]
 * The toolbar floats above the table; the table renders separately.
 */
export function SettingsTableToolbar({
  search,
  filters,
  columns,
}: SettingsTableToolbarProps) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="flex-1 min-w-0 max-w-sm">{search}</div>
      <div className="flex-1" />
      {filters}
      {columns}
    </div>
  );
}
