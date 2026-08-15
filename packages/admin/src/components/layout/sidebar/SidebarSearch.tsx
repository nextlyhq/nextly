import { Input } from "@nextlyhq/ui";

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
        {/* Centred rather than offset from the top. A fixed `top-2.5` centres a
            16px icon in a 36px control and nowhere else, so it was a second
            copy of the height decision that no longer moves with the token. */}
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          // The sidebar is a denser surface than a page, so its search takes
          // the small step of the control scale. Named rather than written as
          // `h-9`: that literal happened to equal the small step and stopped
          // tracking it, which is how a control drifts away from the token
          // while still looking correct.
          size="sm"
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="pl-9 bg-background border-input text-xs"
        />
      </div>
    </div>
  );
}
