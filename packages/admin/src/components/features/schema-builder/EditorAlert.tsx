// Why: PR H (feedback 2.2) -- single subtle alert pattern to replace
// the loud amber AlertTriangle panels and the bg-primary/5 Tip boxes
// across per-type field editors. Brainstorm 2026-05-04 locked the
// look: border-border + bg-muted/20 + small Info icon + muted text,
// no amber/yellow/red.
//
// Why not reuse @revnixhq/ui's Alert: the shared Alert's `info`
// variant uses bg-primary/5 + text-primary (a bluish tint matching the
// framework's primary color). That's literally the same look as the
// "Tip" boxes Mobeen called AI-ish. Mobeen explicitly asked for
// muted grey, not tinted, so a thinner local component is the right
// fit here.
import * as Icons from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

type Props = {
  children: React.ReactNode;
  className?: string;
};

export function EditorAlert({ children, className }: Props) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 p-3 rounded-md border border-border bg-muted/20 text-xs text-muted-foreground",
        className
      )}
    >
      <Icons.Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
      <div className="flex-1">{children}</div>
    </div>
  );
}
