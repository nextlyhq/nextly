import {
  Label,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@revnixhq/ui";
import { Info } from "lucide-react";
import * as React from "react";

import { cn } from "@admin/lib/utils";

export interface FormLabelWithTooltipProps
  extends React.ComponentPropsWithoutRef<typeof Label> {
  label: React.ReactNode;
  description?: React.ReactNode;
  required?: boolean;
  labelClassName?: string;
  tooltipClassName?: string;
}

export const FormLabelWithTooltip = React.forwardRef<
  React.ElementRef<typeof Label>,
  FormLabelWithTooltipProps
>(
  (
    {
      className,
      labelClassName,
      tooltipClassName,
      label,
      description,
      required,
      ...props
    },
    ref
  ) => {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Label ref={ref} className={labelClassName} {...props}>
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </Label>
        {description && (
          <TooltipProvider>
            <Tooltip delayDuration={200}>
              <TooltipTrigger
                type="button"
                tabIndex={-1}
                className="shrink-0 text-muted-foreground hover:text-foreground focus:outline-none focus:text-foreground transition-colors cursor-help"
              >
                <Info className="h-3.5 w-3.5" />
                <span className="sr-only">Toggle description</span>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                className={cn(
                  "max-w-[250px] text-[12px] break-words relative z-[100] shadow-md border bg-black text-white dark:bg-zinc-800 dark:text-zinc-50 px-3 py-2 rounded-none",
                  tooltipClassName
                )}
              >
                {description}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    );
  }
);
FormLabelWithTooltip.displayName = "FormLabelWithTooltip";
