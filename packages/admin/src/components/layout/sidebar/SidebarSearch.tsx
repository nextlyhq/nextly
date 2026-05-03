import { Input } from "@revnixhq/ui";

import { Search } from "@admin/components/icons";

interface SidebarSearchProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}

export function SidebarSearch({
  placeholder,
  value,
  onChange,
}: SidebarSearchProps) {
  return (
    <div className="px-2 pb-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="pl-9 bg-background border-primary/5 text-xs h-9"
        />
      </div>
    </div>
  );
}
