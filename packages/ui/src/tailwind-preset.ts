/**
 * Tailwind CSS preset for @nextlyhq/ui components.
 *
 * Defines the CSS custom property contract that all UI components expect.
 * Consumers must provide the actual CSS variable values in their stylesheets.
 *
 * Usage (Tailwind v3):
 *   // tailwind.config.ts
 *   import uiPreset from "@nextlyhq/ui/tailwind-preset";
 *   export default { presets: [uiPreset], ... };
 *
 * Usage (Tailwind v4 with @config):
 *   Consumers define the equivalent @theme tokens in their CSS.
 *   This file serves as the reference contract.
 */
const uiPreset = {
  theme: {
    extend: {
      colors: {
        border: "var(--nx-border)",
        input: "var(--nx-input)",
        ring: "var(--nx-ring)",
        background: "var(--nx-background)",
        foreground: "var(--nx-foreground)",
        primary: {
          DEFAULT: "var(--nx-primary)",
          foreground: "var(--nx-primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--nx-secondary)",
          foreground: "var(--nx-secondary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--nx-destructive)",
          foreground: "var(--nx-destructive-foreground)",
        },
        success: {
          DEFAULT: "var(--nx-success)",
          foreground: "var(--nx-success-foreground)",
        },
        warning: {
          DEFAULT: "var(--nx-warning)",
          foreground: "var(--nx-warning-foreground)",
        },
        muted: {
          DEFAULT: "var(--nx-muted)",
          foreground: "var(--nx-muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--nx-accent)",
          foreground: "var(--nx-accent-foreground)",
        },
        popover: {
          DEFAULT: "var(--nx-popover)",
          foreground: "var(--nx-popover-foreground)",
        },
        card: {
          DEFAULT: "var(--nx-card)",
          foreground: "var(--nx-card-foreground)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.3s cubic-bezier(0.87, 0, 0.13, 1)",
        "accordion-up": "accordion-up 0.3s cubic-bezier(0.87, 0, 0.13, 1)",
      },
    },
  },
};

export default uiPreset;
