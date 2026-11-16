import type {
  PluginContext,
  PluginVersionPinHolder,
  VersionPinHolderDefinition,
} from "@nextlyhq/plugin-sdk";

// A plugin names what `registerHolder` takes from the SDK alone, so a helper
// that registers its holders can be typed without reaching into `nextly`.
const approvals: VersionPinHolderDefinition = {
  name: "approvals",
  label: "Approvals",
};

function registerApprovals(ctx: PluginContext): PluginVersionPinHolder {
  return ctx.services.versions.pins.registerHolder(approvals);
}

// Exported so lint does not flag the assertions as unused.
export const __versionPinExportsTypeCheck = { approvals, registerApprovals };
