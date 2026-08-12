"use client";

import {
  ThemeProvider as NextThemesProvider,
  useTheme as useNextTheme,
} from "next-themes";
import { useEffect, type ComponentProps } from "react";

type ThemeProviderProps = ComponentProps<typeof NextThemesProvider>;

/**
 * Admin containers this provider drives.
 *
 * A container can opt out with `data-theme-sync="off"`, which means "I set my
 * own light/dark class and nothing else may change it". Without the opt-out
 * there is no way to render two admin scopes in opposite modes on one page:
 * the sync applies ONE resolved mode to every `.nextly-admin` it finds, so a
 * deliberately-light element next to a deliberately-dark one collapses to
 * whichever mode the page is in. Side-by-side comparisons and any embedded
 * preview of the opposite mode need this; ordinary admin containers carry no
 * attribute and stay synchronised.
 */
export const THEME_SYNC_TARGETS = '.nextly-admin:not([data-theme-sync="off"])';

/** Whether a single element is one this provider may retheme. */
export function isThemeSyncTarget(element: Element): boolean {
  return element.matches(THEME_SYNC_TARGETS);
}

/**
 * Theme Sync Component
 *
 * Syncs next-themes state with .nextly-admin container classes.
 * This allows scoped theme switching for the admin panel.
 *
 * Performance optimizations:
 * - Debounced MutationObserver (50ms) to prevent excessive DOM queries
 * - SSR safety check for document.body availability
 * - Error boundary around observer setup for graceful degradation
 * - Only observes when necessary (avoids overhead during SSR)
 */
function ThemeSync() {
  const { resolvedTheme } = useNextTheme();

  useEffect(() => {
    // SSR safety check
    if (typeof window === "undefined" || !document.body) {
      return;
    }

    const isDark = resolvedTheme === "dark";
    let timeoutId: NodeJS.Timeout | null = null;

    // Apply theme to every admin container that has not opted out
    const applyTheme = () => {
      const containers = document.querySelectorAll(THEME_SYNC_TARGETS);
      containers.forEach(container => {
        container.classList.toggle("dark", isDark);
      });
    };

    // Initial application
    applyTheme();

    // Debounced handler for mutation events (50ms debounce)
    const handleMutations = (mutations: MutationRecord[]) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(() => {
        mutations.forEach(mutation => {
          mutation.addedNodes.forEach(node => {
            if (node instanceof HTMLElement && isThemeSyncTarget(node)) {
              node.classList.toggle("dark", isDark);
            }
            // Also check children of added nodes. The opt-out has to hold on
            // this path too: a preview mounted after the first pass would
            // otherwise be rethemed the moment it appears, which is the same
            // defect arriving a frame later.
            if (node instanceof HTMLElement) {
              const children = node.querySelectorAll(THEME_SYNC_TARGETS);
              children.forEach(child => {
                child.classList.toggle("dark", isDark);
              });
            }
          });
        });
        timeoutId = null;
      }, 50); // Balance between responsiveness and performance
    };

    // Watch for dynamically added .nextly-admin containers (e.g., portals)
    let observer: MutationObserver | null = null;

    try {
      observer = new MutationObserver(handleMutations);

      // Observe document body for added nodes
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    } catch (error) {
      // Graceful degradation if MutationObserver fails
      console.warn(
        "ThemeSync: MutationObserver failed to initialize. Dynamic theme changes for portals may not work.",
        error
      );
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (observer) {
        observer.disconnect();
      }
    };
  }, [resolvedTheme]);

  return null;
}

/**
 * Theme Provider for Nextly Admin
 *
 * Wraps next-themes ThemeProvider with nextly-admin-specific configuration.
 * Applies dark mode to .nextly-admin container for scoped theme switching.
 *
 * **Default Configuration** (can be overridden via props):
 * - `defaultTheme`: "system" - Respects OS preference on first load
 * - `storageKey`: "nextly-theme" - LocalStorage key for theme persistence
 * - `enableSystem`: true - Respects OS dark mode preference
 * - `disableTransitionOnChange`: false - Smooth theme transitions
 *
 * When `defaultTheme` is "system":
 * - On first visit with no stored preference, the site uses the OS theme
 * - Dark mode sites will appear dark, light mode sites will appear light
 * - User can override by setting their own preference in the UI
 *
 * **IMPORTANT**: the admin's type is supplied by the host, not by this package.
 * The consuming app is responsible for:
 * - Loading Geist and Geist Mono via next/font/google
 * - Exposing them as the `--font-geist` and `--font-geist-mono` variables
 * - Importing Nextly styles
 *
 * The theme names those variables FIRST in its font stacks and falls back to a
 * generic sans, so a host that skips this renders in the system face rather
 * than breaking. `next/font` self-hosts a face and exposes it only as a
 * variable, which is why the variable rather than the family name is what the
 * host has to provide.
 *
 * @example
 * ```tsx
 * import { ThemeProvider } from "@nextly/admin-app";
 *
 * // Basic usage with defaults (respects system theme)
 * export default function RootLayout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         <ThemeProvider>
 *           {children}
 *         </ThemeProvider>
 *       </body>
 *     </html>
 *   );
 * }
 *
 * // Custom configuration (force a specific default)
 * export default function RootLayout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         <ThemeProvider
 *           defaultTheme="dark"
 *           storageKey="my-app-theme"
 *           disableTransitionOnChange={true}
 *         >
 *           {children}
 *         </ThemeProvider>
 *       </body>
 *     </html>
 *   );
 * }
 * ```
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem={true}
      disableTransitionOnChange={false}
      storageKey="nextly-theme"
      {...props}
    >
      <ThemeSync />
      {children}
    </NextThemesProvider>
  );
}

// Re-export useTheme hook from next-themes for convenience
export { useTheme } from "next-themes";
