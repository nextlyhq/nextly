"use client";

import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Spinner,
} from "@revnixhq/ui";

import { Save, X, Calendar, Clock, User } from "@admin/components/icons";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";

interface PublicationWidgetProps {
  isSaving: boolean;
  onSave: () => void;
  onCancel: () => void;
  isEditing?: boolean;
}

export function PublicationWidget({
  isSaving,
  onSave,
  onCancel,
  isEditing,
}: PublicationWidgetProps) {
  // Current date for display (mock data for now, could be dynamic)
  const now = new Date();
  const dateStr = formatDateWithAdminTimezone(now, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeStr = formatDateWithAdminTimezone(now, {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <Card className="shadow-sm border-border">
      <CardHeader className="pb-3 border-b border-border/50">
        <CardTitle className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          Publishing
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {/* Status Indicators (Non-functional UI for now as requested) */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Created
          </span>
          <span className="font-medium text-foreground">{dateStr}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Time
          </span>
          <span className="font-medium text-foreground">{timeStr}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground flex items-center gap-2">
            <User className="h-4 w-4" />
            Author
          </span>
          <span className="font-medium text-foreground">Admin</span>
        </div>
      </CardContent>
      <CardFooter className="flex flex-col gap-3 pt-4 border-t border-border/50">
        <Button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="w-full flex items-center justify-center gap-2"
        >
          {isSaving ? (
            <>
              <Spinner size="sm" className="mr-2" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              {isEditing ? "Update Changes" : "Create & Publish"}
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSaving}
          className="w-full text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4 mr-2" />
          Discard Changes
        </Button>
      </CardFooter>
    </Card>
  );
}
