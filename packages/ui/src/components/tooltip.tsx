import {
  Provider,
  Root,
  Trigger,
  Portal,
  Content,
} from "@radix-ui/react-tooltip";
import { forwardRef } from "react";

import { cn } from "../lib/utils";
import { usePortalContainer } from "../providers/portal-provider";

const TooltipProvider = Provider;

const Tooltip = Root;

const TooltipTrigger = Trigger;

const TooltipContent = forwardRef<
  React.ElementRef<typeof Content>,
  React.ComponentPropsWithoutRef<typeof Content>
>(({ className, sideOffset = 4, ...props }, ref) => {
  const portalContainer = usePortalContainer();

  return (
    // Portalled for the same reason as every other overlay here, plus one
    // specific to the tooltip: the positioner measures against the nearest
    // containing block, and it counts `container-type` as one while the
    // browser does not. Left inline under a `@container` element, the content
    // is offset by that element's own position. Portalling lifts it out of any
    // such ancestor, so the two agree again.
    <Portal container={portalContainer}>
      <Content
        ref={ref}
        sideOffset={sideOffset}
        data-slot="tooltip-content"
        className={cn(
          "z-50 overflow-hidden rounded-none px-3 py-1.5 text-xs shadow-lg  border border-border bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className
        )}
        {...props}
      />
    </Portal>
  );
});
TooltipContent.displayName = Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
