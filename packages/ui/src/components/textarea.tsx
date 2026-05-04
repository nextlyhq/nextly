import type { TextareaHTMLAttributes } from "react";
import { forwardRef } from "react";

import { cn } from "../lib/utils";

const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-[80px] w-full rounded-none border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground placeholder:opacity-50 transition-all duration-200 focus:!border-primary focus-visible:!border-primary focus:outline-none hover:border-primary/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-primary/5 resize-y",
        "aria-invalid:border-destructive aria-invalid:focus:!border-destructive",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
