import { isMarkerSet, personOffVariable, type Env } from "./env-flags.js";

// When the installer and the `nextly` CLI stay off. Four rules, and nothing
// else: a person's "no" (either variable, or the machine's own setting), a
// CI run, or a deploy build on a hosting platform. A run with no terminal, a
// run inside Docker and a run in production mode are counted like any other,
// so this guard does not read the terminal, the container or `NODE_ENV` at
// all. It reads only the environment and the machine's setting, so it is
// decided before anything could open a connection.

/**
 * CI services, each by the variables it sets. `CI` alone covers most of
 * them; the rest are for services that do not set it.
 */
export const CI_MARKERS: Readonly<Record<string, readonly string[]>> = {
  generic: ["CI", "CONTINUOUS_INTEGRATION"],
  "GitHub Actions": ["GITHUB_ACTIONS"],
  "GitLab CI": ["GITLAB_CI"],
  CircleCI: ["CIRCLECI"],
  "Travis CI": ["TRAVIS"],
  Jenkins: ["JENKINS_URL"],
  Buildkite: ["BUILDKITE"],
  "Azure Pipelines": ["TF_BUILD"],
  "Bitbucket Pipelines": ["BITBUCKET_BUILD_NUMBER"],
  "AWS CodeBuild": ["CODEBUILD_BUILD_ID"],
  TeamCity: ["TEAMCITY_VERSION"],
  Drone: ["DRONE"],
  Semaphore: ["SEMAPHORE"],
  AppVeyor: ["APPVEYOR"],
  Bitrise: ["BITRISE_IO"],
  Buddy: ["BUDDY_WORKSPACE_ID"],
  Codefresh: ["CF_BUILD_ID"],
  "Gitea Actions": ["GITEA_ACTIONS"],
  "Expo EAS Build": ["EAS_BUILD"],
};

/**
 * Hosting platforms whose builds run the CLI, each by the variables it sets
 * while building. A CLI run there is a deploy build, not a person's use.
 * (A running site on these hosts is counted: the site guard never reads
 * this list.)
 */
export const DEPLOY_BUILD_MARKERS: Readonly<Record<string, readonly string[]>> =
  {
    Vercel: ["VERCEL", "NOW_BUILDER"],
    Netlify: ["NETLIFY"],
    Render: ["RENDER"],
    "Cloudflare Pages": ["CF_PAGES"],
    "Cloudflare Workers Builds": ["WORKERS_CI"],
    Railway: ["RAILWAY_ENVIRONMENT_NAME"],
    "AWS Amplify": ["AWS_APP_ID"],
  };

/** Why the installer or CLI is off, as a fixed reason. */
export type ToolsOffReason =
  | "DO_NOT_TRACK"
  | "NEXTLY_TELEMETRY_DISABLED"
  | "machine-setting"
  | "ci"
  | "deploy-build";

export type ToolsDecision =
  | { on: true; reason: null; personSaidNo: false }
  | {
      on: false;
      reason: ToolsOffReason;
      /**
       * True when any of a person's rules says no (either variable or the
       * machine's setting), whichever rule `reason` names. A run that is off
       * only because of CI or a deploy build is not a person's "no", so the
       * first-admin switch it leads to starts ticked.
       */
      personSaidNo: boolean;
    };

export interface ToolsGuardInput {
  env: Env;
  /** The machine's own setting (`nextly telemetry enable` / `disable`). */
  machineEnabled: boolean;
}

function anyMarker(
  env: Env,
  markers: Readonly<Record<string, readonly string[]>>
) {
  return Object.values(markers).some(names =>
    names.some(name => isMarkerSet(env[name]))
  );
}

/** True when the run is in CI, by any marker in `CI_MARKERS`. */
function isCiRun(env: Env): boolean {
  return anyMarker(env, CI_MARKERS);
}

/** True when the run is a hosting platform's build. */
function isDeployBuild(env: Env): boolean {
  return anyMarker(env, DEPLOY_BUILD_MARKERS);
}

/**
 * Decides whether the installer or the CLI may send. A person's rules are
 * named first, so `nextly telemetry status` explains a "no" by what the
 * person did rather than by where the run happened.
 */
export function resolveToolsUsage(input: ToolsGuardInput): ToolsDecision {
  const { env, machineEnabled } = input;
  const variable = personOffVariable(env);
  const personSaidNo = variable !== null || !machineEnabled;

  if (variable) return { on: false, reason: variable, personSaidNo };
  if (!machineEnabled) {
    return { on: false, reason: "machine-setting", personSaidNo };
  }
  if (isCiRun(env)) return { on: false, reason: "ci", personSaidNo };
  if (isDeployBuild(env)) {
    return { on: false, reason: "deploy-build", personSaidNo };
  }
  return { on: true, reason: null, personSaidNo: false };
}
