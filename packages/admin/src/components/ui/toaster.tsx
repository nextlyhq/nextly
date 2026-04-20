import { Toaster as UIToaster } from "@revnixhq/ui";
import type { ToasterProps } from "sonner";

import { useTheme } from "@admin/context/providers/ThemeProvider";

export function Toaster(props: Omit<ToasterProps, "theme">) {
  const { theme } = useTheme();
  return <UIToaster theme={theme as "light" | "dark" | "system"} {...props} />;
}

// Re-export toast for convenience
export { toast } from "@revnixhq/ui";
