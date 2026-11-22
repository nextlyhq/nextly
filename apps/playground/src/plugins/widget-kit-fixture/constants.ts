/**
 * The widget-kit fixture's component paths, shared by the plugin definition
 * (loaded with the config, in Node) and `admin.tsx` (loaded in the browser),
 * so the definition never imports the client components.
 */

/** A card built only from the widget kit. */
export const KIT_CARD_COMPONENT = "@/plugins/widget-kit-fixture/admin#KitCard";

/** A card whose component throws while it draws. */
export const THROWING_CARD_COMPONENT =
  "@/plugins/widget-kit-fixture/admin#ThrowingCard";

/** A card drawing a text input with no label, for the accessibility check. */
export const UNLABELLED_CONTROL_COMPONENT =
  "@/plugins/widget-kit-fixture/admin#UnlabelledControlCard";
