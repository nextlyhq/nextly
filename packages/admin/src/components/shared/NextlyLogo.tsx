import React from "react";

import { cn } from "@admin/lib/utils";

interface NextlyLogoProps extends React.ComponentProps<"div"> {
  className?: string;
  collapsed?: boolean;
}

export function NextlyLogo({
  className,
  collapsed,
  ...props
}: NextlyLogoProps) {
  return (
    <div
      className={cn("relative flex items-center justify-center", className)}
      {...props}
    >
      {/* <img
        src="/nextly-logo.svg"
        alt="Nextly Logo"
        className={cn(
          "transition-all duration-200 object-contain h-full w-auto",
          collapsed && "w-8 h-8"
        )}
      /> */}
      21st Century
    </div>
  );
}
