"use client";

import { Button } from "@revnixhq/ui";

import { ArrowLeft, LayoutDashboard, Settings } from "@admin/components/icons";
import { ROUTES } from "@admin/constants/routes";
import { useRouter } from "@admin/hooks/useRouter";
import { navigateTo } from "@admin/lib/navigation";

export function MaintenancePage() {
  const { _pathname } = useRouter();

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] w-full bg-background p-4">
      {/* Container */}
      <div className="flex flex-col items-center text-center max-w-[500px] w-full px-6 py-12 rounded-none bg-white ">
        {/* 503 Big number */}
        <div className="mb-2 select-none">
          <span className="text-[120px] font-black leading-none tracking-tight text-slate-800">
            503
          </span>
        </div>

        {/* Badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-none text-xs font-medium bg-amber-50 text-amber-700 mb-6  border border-primary/5 border-amber-200/50">
          <Settings className="h-3 w-3 animate-spin duration-[3000ms]" />
          Maintenance Mode
        </div>

        {/* Headline */}
        <h1 className="text-xl font-bold text-slate-900 mb-8">
          System under maintenance
        </h1>

        {/* Actions */}
        <div className="flex items-center justify-center gap-4 w-full sm:w-auto">
          <Button
            variant="outline"
            className="w-full sm:w-[140px] gap-2 rounded-none font-medium text-slate-700 border-primary/5"
            onClick={() => window.history.back()}
          >
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </Button>
          <Button
            className="w-full sm:w-[140px] gap-2 rounded-none font-medium bg-[#3b8c38] hover:bg-[#2f702d] text-white border-0"
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
