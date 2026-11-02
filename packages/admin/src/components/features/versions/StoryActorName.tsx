/**
 * Who or what did something in a history: a person, an API key, a release,
 * the system or an agent, named with an icon for the kind.
 *
 * A module of its own so a history outside the versions screen (a release's
 * page) can name its actors without loading the version rows beside it.
 *
 * @module components/features/versions/StoryActorName
 */

import { Bot, Cog, KeyRound, Rocket, User, UserRound } from "lucide-react";
import type { JSX } from "react";

import type { HistoryActorKind } from "@admin/services/versionApi";

import type { StoryActor } from "./history-story-text";

/** The icon for each kind of actor; a person when none was recorded. */
const ACTOR_ICONS: Record<HistoryActorKind, typeof User> = {
  person: User,
  apiKey: KeyRound,
  principal: UserRound,
  release: Rocket,
  system: Cog,
  agent: Bot,
};

/** Who or what did it, with an icon for the kind. */
export function StoryActorName({ actor }: { actor: StoryActor }): JSX.Element {
  const Icon = actor.kind ? ACTOR_ICONS[actor.kind] : User;
  const name =
    actor.kind === "release" ? `Release “${actor.name}”` : actor.name;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 truncate font-medium text-foreground">
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{name}</span>
    </span>
  );
}
