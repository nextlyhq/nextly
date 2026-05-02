import { Button } from "@revnixhq/ui";
import type React from "react";

import { ArrowLeft } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

interface BuilderPageHeaderProps {
  title: string;
  description: string;
  backRoute?: string;
  entityType?: "collection" | "single" | "component";
  actions?: React.ReactNode;
}

export function BuilderPageHeader({
  title,
  description,
  backRoute,
  entityType = "collection",
  actions,
}: BuilderPageHeaderProps) {
  // Determine back route
  const resolvedBackRoute =
    backRoute ??
    (entityType === "single"
      ? ROUTES.SINGLES
      : entityType === "component"
        ? ROUTES.COMPONENTS
        : ROUTES.COLLECTIONS);

  return (
    <div className="flex items-start justify-between mb-8">
      <div className="flex items-start gap-4">
        <Link href={resolvedBackRoute}>
          <Button variant="ghost" size="icon" type="button" className="mt-1">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="text-sm font-normal text-primary/50 mt-1">{description}</p>
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
