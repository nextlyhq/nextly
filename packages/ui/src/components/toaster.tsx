"use client";

import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  XCircle,
  Loader2,
} from "lucide-react";
import { toast, Toaster as Sonner, type ToasterProps } from "sonner";

// Re-export toast function for convenient usage
export { toast };

/**
 * Toaster Component - Toast Notification System
 *
 * A wrapper around Sonner (opinionated toast component for React) with
 * custom icons. Provides a consistent notification system across the application.
 *
 * Features:
 * - Theme support via `theme` prop (light/dark/system)
 * - Custom icons from lucide-react matching design system
 * - 6 toast types: default, success, info, warning, error, loading (promise-based)
 * - Action button support (Undo, Retry, etc.)
 * - Configurable positioning (default: bottom-right)
 * - Automatic stacking and dismissal
 * - WCAG 2.2 AA compliant colors via CSS variables
 *
 * Setup:
 * 1. Add <Toaster /> to your root layout (once per app)
 * 2. Import toast from '@revnixhq/ui' to trigger notifications
 *
 * Usage Examples:
 *
 * // Default toast
 * import { toast } from '@revnixhq/ui';
 * toast("Event has been created");
 *
 * // Success toast
 * toast.success("User created successfully!");
 *
 * // Error toast
 * toast.error("Failed to save changes. Please try again.");
 *
 * // Warning toast
 * toast.warning("This action cannot be undone.");
 *
 * // Info toast
 * toast.info("Be at the area 10 minutes before the event time");
 *
 * // Toast with action button
 * toast("Event deleted", {
 *   description: "You can undo this action",
 *   action: {
 *     label: "Undo",
 *     onClick: () => console.log("Undo clicked"),
 *   },
 * });
 *
 * // Promise-based toast (loading → success/error)
 * toast.promise(
 *   fetchData(),
 *   {
 *     loading: "Loading...",
 *     success: (data) => `${data.name} has been created`,
 *     error: "Failed to load data",
 *   }
 * );
 *
 * Positioning Options:
 * <Toaster position="top-right" />
 * <Toaster position="top-center" />
 * <Toaster position="bottom-left" />
 * <Toaster position="bottom-center" />
 * <Toaster position="bottom-right" /> (default)
 *
 * Customization:
 * All styling uses CSS variables from the design system:
 * - --normal-bg: Background color (uses --popover with fallback)
 * - --normal-text: Text color (uses --popover-foreground with fallback)
 * - --normal-border: Border color (uses --border with fallback)
 * - --border-radius: Border radius (uses --radius with fallback)
 *
 * Security:
 * ⚠️ IMPORTANT: Toast content is not automatically sanitized. When displaying
 * user-generated content or data from external sources, ensure you sanitize
 * the content to prevent XSS attacks. Use plain text strings when possible,
 * or sanitize HTML/JSX content before passing to toast functions.
 *
 * Safe: toast.success(`User ${username} created`) // Template literals with plain text
 * Unsafe: toast.success(<div dangerouslySetInnerHTML={{__html: userInput}} />) // XSS risk
 * Safe: toast.success(<div>{sanitizeHtml(userInput)}</div>) // Sanitized content
 *
 * Accessibility:
 * - Screen reader announcements for all toast types
 * - Keyboard dismissible (Escape key)
 * - Focus management for action buttons
 * - ARIA labels automatically applied
 * - WCAG 2.2 AA color contrast
 *
 * @see https://sonner.emilkowal.ski/ - Sonner documentation
 * @see https://ui.shadcn.com/docs/components/sonner - shadcn/ui integration guide
 */
export function Toaster({ theme = "system", ...props }: ToasterProps) {
  return (
    <Sonner
      theme={theme}
      className="toaster group !bg-transparent !overflow-visible !z-[9999]"
      data-slot="toaster"
      toastOptions={{
        classNames: {
          description: "text-muted-foreground",
        },
      }}
      icons={{
        success: <CheckCircle2 className="h-4 w-4" />,
        info: <AlertCircle className="h-4 w-4" />,
        warning: <AlertTriangle className="h-4 w-4" />,
        error: <XCircle className="h-4 w-4" />,
        loading: <Loader2 className="h-4 w-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "hsl(var(--popover, 0 0% 100%))",
          "--normal-text": "hsl(var(--popover-foreground, 222.2 84% 4.9%))",
          "--normal-border": "hsl(var(--border, 214.3 31.8% 91.4%))",
          "--border-radius": "0px",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
