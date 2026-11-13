/**
 * What `@nextlyhq/admin`'s root publishes: what an application mounts, and the
 * hooks and primitives its README lists for an application's own components.
 *
 * The root is the admin's first load. A library entry cannot drop its own
 * unused exports, so every value exported there is downloaded before any admin
 * screen draws, whether a screen uses it or not. Everything else the admin
 * offers lives in `@nextlyhq/admin/kit` (`src/kit.ts`), which
 * `@nextlyhq/plugin-sdk/admin` re-exports to plugins. Read from the built
 * entries, since those are what ship.
 */
import { join, resolve } from "node:path";

import { exportStatements } from "@nextlyhq/module-specifiers/declaration-exports";
import { describe, expect, it } from "vitest";

const DIST = resolve(__dirname, "../../dist");

/** The values a built entry exports, sorted. */
function valueExports(entry: string): string[] {
  const { named, declared, stars } = exportStatements(join(DIST, entry));
  // A whole-module re-export would publish names this list cannot see.
  expect(stars, `${entry} re-exports a whole module`).toEqual([]);
  return [...named.map(name => name.exported), ...declared].sort();
}

/** The root's values. Types cost the first load nothing and are not listed. */
const ROOT_VALUES = [
  "Accordion",
  "AccordionContent",
  "AccordionItem",
  "AccordionTrigger",
  "Alert",
  "AlertDescription",
  "AlertTitle",
  "Avatar",
  "AvatarFallback",
  "AvatarImage",
  "Badge",
  "BrandingProvider",
  "Button",
  "Can",
  "Card",
  "CardAction",
  "CardContent",
  "CardDescription",
  "CardFooter",
  "CardHeader",
  "CardTitle",
  "Checkbox",
  "Command",
  "CommandDialog",
  "CommandEmpty",
  "CommandGroup",
  "CommandInput",
  "CommandItem",
  "CommandList",
  "CommandPalette",
  "CommandSeparator",
  "CommandShortcut",
  "Dialog",
  "DialogClose",
  "DialogContent",
  "DialogDescription",
  "DialogFooter",
  "DialogHeader",
  "DialogOverlay",
  "DialogPortal",
  "DialogTitle",
  "DialogTrigger",
  "DropdownMenu",
  "DropdownMenuCheckboxItem",
  "DropdownMenuContent",
  "DropdownMenuGroup",
  "DropdownMenuItem",
  "DropdownMenuLabel",
  "DropdownMenuPortal",
  "DropdownMenuRadioGroup",
  "DropdownMenuRadioItem",
  "DropdownMenuSeparator",
  "DropdownMenuShortcut",
  "DropdownMenuSub",
  "DropdownMenuSubContent",
  "DropdownMenuSubTrigger",
  "DropdownMenuTrigger",
  "ErrorBoundary",
  "FieldShell",
  "FormActions",
  "FormSection",
  "Grid",
  "Input",
  "Label",
  "PageFrame",
  "PageHeader",
  "PageTab",
  "PageTabs",
  "Progress",
  "QueryErrorBoundary",
  "QueryProvider",
  "RadioGroup",
  "RadioGroupItem",
  "RootLayout",
  "Select",
  "SelectContent",
  "SelectGroup",
  "SelectItem",
  "SelectLabel",
  "SelectScrollDownButton",
  "SelectScrollUpButton",
  "SelectSeparator",
  "SelectTrigger",
  "SelectValue",
  "Sheet",
  "SheetClose",
  "SheetContent",
  "SheetDescription",
  "SheetFooter",
  "SheetHeader",
  "SheetOverlay",
  "SheetPortal",
  "SheetTitle",
  "SheetTrigger",
  "Skeleton",
  "Spinner",
  "Stack",
  "Stat",
  "Switch",
  "Tabs",
  "TabsContent",
  "TabsList",
  "TabsTrigger",
  "Textarea",
  "ThemePaintScript",
  "ThemeProvider",
  "Toaster",
  "Tooltip",
  "TooltipContent",
  "TooltipProvider",
  "TooltipTrigger",
  "alertVariants",
  "avatarVariants",
  "badgeVariants",
  "buttonVariants",
  "cardVariants",
  "dialogContentVariants",
  "inputVariants",
  "progressVariants",
  "registerComponent",
  "registerComponentMap",
  "registerComponents",
  "selectTriggerVariants",
  "spinnerVariants",
  "toast",
  "useBranding",
  "useBulkMutation",
  "useCan",
  "useCollection",
  "useCollections",
  "useDashboardStats",
  "useDebouncedValue",
  "useMedia",
  "useMediaItem",
  "useRecentActivity",
  "useRoles",
  "useRowSelection",
  "useTheme",
  "useUsers",
];

const NOT_ON_THE_LIST =
  "@nextlyhq/admin's root exports a value its list does not hold. The root is downloaded before any admin screen draws: a part for plugins belongs in src/kit.ts, which @nextlyhq/plugin-sdk/admin re-exports. A value an application must import from the root is added to ROOT_VALUES here, in the same change.";

describe("the admin's root entry", () => {
  it("exports only the values on its list", () => {
    expect(valueExports("index.mjs"), NOT_ON_THE_LIST).toEqual(ROOT_VALUES);
  });

  it("leaves none of them out of the kit, which the SDK re-exports whole", () => {
    const kit = new Set(valueExports("kit.mjs"));
    expect(ROOT_VALUES.filter(name => !kit.has(name))).toEqual([]);
  });

  it("CONTROL: the kit carries the parts plugin pages are built from", () => {
    const kit = new Set(valueExports("kit.mjs"));
    const parts = ["MediaLibrary", "FieldSettingsPanel", "Stepper", "ListView"];
    expect(parts.filter(name => !kit.has(name))).toEqual([]);
    expect(parts.filter(name => ROOT_VALUES.includes(name))).toEqual([]);
  });
});
