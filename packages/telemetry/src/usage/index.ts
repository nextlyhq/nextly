// The usage-data surface: the catalog (as types and as plain data), the two
// guards, agent detection, the builders, the machine setting and the
// sessions that send. Marked experimental while the installer, the CLI and
// sites move onto it; until then the package root's earlier exports stay as
// they were.

export {
  AGENT_NAMES,
  CATALOG_VERSION,
  CODING_TOOLS,
  COMMAND_ROLES,
  COUNT_RANGES,
  DATABASES,
  EXIT_CODES,
  FEATURES,
  HEARD_FROM,
  HOSTS,
  INSTALL_ERROR_CODES,
  INSTALL_SECTIONS,
  INSTALL_STEPS,
  PAGE_LABELS,
  SITE_NOTICE_VERSION,
  SITE_ROLES,
  STARTS,
  TOOLS_NOTICE_VERSION,
  USAGE_EVENTS,
  type AgentName,
  type EventSpec,
  type PropertySpec,
  type ToolsSource,
  type UsageEventFor,
  type UsageEventName,
  type UsageEventProperties,
  type UsageSource,
} from "./catalog.js";
export { usageCatalogData, type UsageCatalogData } from "./catalog-data.js";
export { detectAgent, type RunBy } from "./agent.js";
export {
  CI_MARKERS,
  DEPLOY_BUILD_MARKERS,
  resolveToolsUsage,
  type ToolsDecision,
  type ToolsGuardInput,
  type ToolsOffReason,
} from "./guard-tools.js";
export {
  TEST_RUNNER_MARKERS,
  resolveSiteUsage,
  type SiteDecision,
  type SiteGuardInput,
  type SiteOffReason,
} from "./guard-site.js";
export {
  countRange,
  installErrorCode,
  newRandomId,
  pageLabelFrom,
  pluginsOn,
} from "./builders.js";
export {
  readMachineUsage,
  saveMachineUsageOff,
  type MachineUsage,
} from "./machine.js";
export {
  openSiteUsage,
  openToolsUsage,
  type SiteUsageOptions,
  type SiteUsageSession,
  type ToolsUsageOptions,
  type ToolsUsageSession,
} from "./session.js";
