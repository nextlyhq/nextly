"use client";

import {
  ThemeProvider as NextThemesProvider,
  useTheme as useNextTheme,
} from "next-themes";
import { useEffect, type ComponentProps } from "react";

type ThemeProviderProps = ComponentProps<typeof NextThemesProvider>;

/**
 * Theme Sync Component
 *
 * Syncs next-themes state with .adminapp container classes.
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

    // Apply theme to all existing .adminapp containers
    const applyTheme = () => {
      const containers = document.querySelectorAll(".adminapp");
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
            if (
              node instanceof HTMLElement &&
              node.classList.contains("adminapp")
            ) {
              node.classList.toggle("dark", isDark);
            }
            // Also check children of added nodes
            if (node instanceof HTMLElement) {
              const children = node.querySelectorAll(".adminapp");
              children.forEach(child => {
                child.classList.toggle("dark", isDark);
              });
            }
          });
        });
        timeoutId = null;
      }, 50); // Balance between responsiveness and performance
    };

    // Watch for dynamically added .adminapp containers (e.g., portals)
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
 * Wraps next-themes ThemeProvider with adminapp-specific configuration.
 * Applies dark mode to .adminapp container for scoped theme switching.
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
 * **IMPORTANT**: This provider must be used within a Next.js app that has
 * loaded the Inter font. The consuming app is responsible for:
 * - Loading Inter font via next/font/google
 * - Providing --font-inter CSS variable
 * - Importing Nextly styles
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
