// Shown at the top of the builder when a collection/single/component is
// code-first (locked). The builder itself already renders every control
// disabled; this notice makes the read-only intent explicit and points to
// the source file so devs know where to make changes.
import { Lock } from "@admin/components/icons";

import type { BuilderConfig } from "./builder-config";

const KIND_LABEL: Record<BuilderConfig["kind"], string> = {
  collection: "collection",
  single: "single",
  component: "component",
};

type Props = {
  kind: BuilderConfig["kind"];
  /** Absolute/relative path of the file the entity is defined in, if known. */
  configPath?: string | null;
};

export function BuilderReadOnlyNotice({ kind, configPath }: Props) {
  const label = KIND_LABEL[kind];

  return (
    <div
      role="note"
      className="flex items-start gap-3 border border-border bg-muted p-4 mb-6"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-border bg-background">
        <Lock className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-foreground">
          Read-only — defined in code
        </p>
        <p className="mt-1 text-muted-foreground leading-relaxed">
          This {label} is managed in your codebase, so its structure and
          settings can be viewed here but not edited. Update its definition in
          code to make changes.
        </p>
        {configPath ? (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="uppercase tracking-wide">Source</span>
            <code className="font-mono text-foreground break-all">
              {configPath}
            </code>
          </p>
        ) : null}
      </div>
    </div>
  );
}
