/**
 * Tailwind CSS preset for @nextlyhq/ui components.
 *
 * Defines the CSS custom property contract that all UI components expect.
 * Consumers must provide the actual CSS variable values in their stylesheets.
 *
 * Usage (Tailwind v3, ESM):
 *   // tailwind.config.ts
 *   import uiPreset from "@nextlyhq/ui/tailwind-preset";
 *   export default { presets: [uiPreset], ... };
 *
 * Usage (Tailwind v3, CommonJS):
 *   // tailwind.config.js
 *   const { uiPreset } = require("@nextlyhq/ui/tailwind-preset");
 *   module.exports = { presets: [uiPreset], ... };
 *
 * Usage (Tailwind v4 with @config):
 *   Consumers define the equivalent @theme tokens in their CSS.
 *   This file serves as the reference contract.
 */
/**
 * The numbered shade scale for a status color, mixed from its base the same way
 * the v4 `@theme` block does, so v3 preset consumers get the same utilities the
 * components emit (`bg-destructive-700`, `bg-success-100 text-success-700`, ...).
 */
const statusScale = (base: string): Record<number, string> => ({
  50: `color-mix(in srgb, var(${base}), white 95%)`,
  100: `color-mix(in srgb, var(${base}), white 90%)`,
  200: `color-mix(in srgb, var(${base}), white 70%)`,
  300: `color-mix(in srgb, var(${base}), white 50%)`,
  400: `color-mix(in srgb, var(${base}), white 30%)`,
  500: `var(${base})`,
  600: `color-mix(in srgb, var(${base}), black 10%)`,
  700: `color-mix(in srgb, var(${base}), black 30%)`,
  800: `color-mix(in srgb, var(${base}), black 50%)`,
  900: `color-mix(in srgb, var(${base}), black 70%)`,
  950: `color-mix(in srgb, var(${base}), black 85%)`,
});

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
          // Saturated fill for solid buttons, distinct from the text-tuned base.
          solid: "var(--nx-destructive-solid)",
          foreground: "var(--nx-destructive-foreground)",
          ...statusScale("--nx-destructive"),
        },
        success: {
          DEFAULT: "var(--nx-success)",
          solid: "var(--nx-success-solid)",
          foreground: "var(--nx-success-foreground)",
          ...statusScale("--nx-success"),
        },
        warning: {
          DEFAULT: "var(--nx-warning)",
          foreground: "var(--nx-warning-foreground)",
          ...statusScale("--nx-warning"),
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

// Exported both ways on purpose. CommonJS cannot represent a default-only
// module without `module.exports =`, which makes the emitted declarations
// disagree with the runtime shape (attw's FalseExportDefault); a named export
// alongside it keeps `require()` and `import` consistent and typed.
export { uiPreset };
export default uiPreset;
