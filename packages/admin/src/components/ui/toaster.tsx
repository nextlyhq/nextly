import { Toaster as UIToaster } from "@nextlyhq/ui";
import type { JSX } from "react";
import type { ToasterProps } from "sonner";

import { TOAST_OFFSET_BOTTOM_PROPERTY } from "@admin/constants/ui";
import { useTheme } from "@admin/context/providers/ThemeProvider";

/**
 * The toaster's bottom offsets: Sonner's own defaults (24px, and 16px on a
 * phone) unless something in the corner has set the shared property, which
 * Sonner passes through as written. A caller's own `offset` still wins.
 */
const OFFSET = { bottom: `var(${TOAST_OFFSET_BOTTOM_PROPERTY}, 24px)` };
const MOBILE_OFFSET = { bottom: `var(${TOAST_OFFSET_BOTTOM_PROPERTY}, 16px)` };

export function Toaster(props: Omit<ToasterProps, "theme">): JSX.Element {
  const { theme } = useTheme();
  return (
    <UIToaster
      theme={theme as "light" | "dark" | "system"}
      offset={OFFSET}
      mobileOffset={MOBILE_OFFSET}
      {...props}
    />
  );
}

// Re-export toast for convenience
export { toast } from "@nextlyhq/ui";
