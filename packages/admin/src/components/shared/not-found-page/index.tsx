"use client";

import { Button } from "@nextlyhq/ui";

import { ArrowLeft, LayoutDashboard } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { ROUTES } from "@admin/constants/routes";
import { navigateTo } from "@admin/lib/navigation";

export function NotFoundPage() {
  return (
    <PageContainer className="flex flex-col items-center justify-center min-h-[calc(100vh-64px)]">
      {/* Container */}
      <div className="flex flex-col items-center text-center max-w-[500px] w-full px-6 py-12 rounded-none bg-card  border border-border">
        {/* 404 Big number */}
        <div className="mb-2 select-none">
          <span className="text-[120px] font-black leading-none tracking-tight text-foreground">
            404
          </span>
        </div>

        {/* Badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-none text-xs font-medium bg-success-50 text-success-700 mb-6">
          <span className="h-1.5 w-1.5 rounded-none bg-success-500" />
          Page Not Found
        </div>

        {/* Headline */}
        <h1 className="text-lg sm:text-xl font-semibold text-foreground mb-2">
          Oops! This page doesn&apos;t exist
        </h1>
        <p className="text-sm text-muted-foreground mb-8 max-w-[340px]">
          The page you&apos;re looking for may have been moved, deleted, or the
          URL might be incorrect.
        </p>

        {/* Actions */}
        <div className="flex items-center justify-center gap-4 w-full sm:w-auto">
          <Button
            variant="outline"
            className="w-full sm:w-[140px] gap-2 rounded-none font-medium text-foreground border-border hover:bg-primary/5"
            onClick={() => window.history.back()}
          >
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </Button>
          <Button
            className="w-full sm:w-[140px] gap-2 rounded-none font-medium bg-primary hover:bg-primary/90 text-primary-foreground border-0"
            onClick={() => navigateTo(ROUTES.DASHBOARD)}
          >
            <LayoutDashboard className="h-4 w-4" />
            Dashboard
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
