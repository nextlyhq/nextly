"use client";

import { Button } from "@nextlyhq/ui";
import type { JSX } from "react";

import { ArrowLeft, LayoutDashboard, Settings } from "@admin/components/icons";
import { ROUTES } from "@admin/constants/routes";
import { navigateTo } from "@admin/lib/navigation";

export function MaintenancePage(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] w-full bg-background p-4">
      {/* Container */}
      <div className="flex flex-col items-center text-center max-w-[500px] w-full px-6 py-12 rounded-lg bg-card ">
        {/* 503 Big number: a decorative numeral, not type. The scale tops
            out at 60px, so there is no step to map this onto. */}
        <div className="mb-2 select-none">
          <span className="text-[120px] font-black leading-none tracking-tight text-foreground">
            503
          </span>
        </div>

        {/* Badge */}
        {/* A quiet chip, as the Badge draws one: the card's fill and the
            page's text, with the status carried by the icon's colour. */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-card text-foreground mb-6 border border-border">
          <Settings className="h-3 w-3 text-warning-text animate-spin duration-[3000ms]" />
          Maintenance Mode
        </div>

        {/* Headline */}
        <h1 className="text-xl font-bold text-foreground mb-8">
          System under maintenance
        </h1>

        {/* Actions */}
        <div className="flex items-center justify-center gap-4 w-full sm:w-auto">
          <Button
            variant="outline"
            className="w-full sm:w-[140px] gap-2 rounded-md font-medium text-foreground border-border"
            onClick={() => window.history.back()}
          >
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </Button>
          {/* Fill and label come from the button's own primary variant so the
              action follows the brand instead of a fixed green. */}
          <Button
            className="w-full sm:w-[140px] gap-2 rounded-md font-medium"
            onClick={() => navigateTo(ROUTES.DASHBOARD)}
          >
            <LayoutDashboard className="h-4 w-4" />
            Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
