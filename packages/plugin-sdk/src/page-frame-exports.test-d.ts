/**
 * The page frame and header a plugin's page is drawn from, as the admin entry
 * hands them: the frame takes one of the four page types and nothing else,
 * and the header takes the page's title and its optional parts.
 *
 * Every assertion is one the checker evaluates; none rests on
 * `@ts-expect-error`.
 */
import type { ComponentProps, ReactNode } from "react";
import { expectTypeOf } from "vitest";

import {
  PageFrame,
  PageHeader,
  PageTab,
  PageTabs,
} from "@nextlyhq/plugin-sdk/admin";
import type {
  PageFrameProps,
  PageHeaderProps,
  PageTabProps,
  PageTabsProps,
  PageType,
} from "@nextlyhq/plugin-sdk/admin";

// The four page types, and only those.
expectTypeOf<PageType>().toEqualTypeOf<
  "list" | "form" | "editor" | "workspace"
>();
expectTypeOf<PageFrameProps["type"]>().toEqualTypeOf<PageType>();

// The component itself takes the type, required, and refuses any other.
type FrameType = ComponentProps<typeof PageFrame>["type"];
expectTypeOf<FrameType>().toEqualTypeOf<PageType>();
expectTypeOf<"wide">().not.toExtend<FrameType>();
expectTypeOf<"dashboard">().not.toExtend<FrameType>();
expectTypeOf<string>().not.toExtend<FrameType>();
expectTypeOf<{ children: ReactNode }>().not.toExtend<
  ComponentProps<typeof PageFrame>
>();
expectTypeOf<{ type: "form"; children: ReactNode }>().toExtend<
  ComponentProps<typeof PageFrame>
>();

// The header's title is a required string; its other parts are optional and
// take anything React draws, so an action can be a button and a description
// can carry a link.
type HeaderProps = ComponentProps<typeof PageHeader>;
expectTypeOf<HeaderProps["title"]>().toEqualTypeOf<string>();
expectTypeOf<PageHeaderProps["title"]>().toEqualTypeOf<string>();
expectTypeOf<{ actions: ReactNode }>().not.toExtend<HeaderProps>();
expectTypeOf<{
  title: string;
  description: ReactNode;
  actions: ReactNode;
  meta: ReactNode;
  media: ReactNode;
  breadcrumbs: ReactNode;
  tabs: ReactNode;
  titleId: string;
}>().toExtend<HeaderProps>();
expectTypeOf<PageHeaderProps["actions"]>().toEqualTypeOf<
  ReactNode | undefined
>();
expectTypeOf<PageHeaderProps["meta"]>().toEqualTypeOf<ReactNode | undefined>();

// A tab row is labelled, and each tab leads somewhere: its own `href`, or the
// router link it wraps.
expectTypeOf<PageTabsProps["label"]>().toEqualTypeOf<string>();
expectTypeOf<{ label: string }>().toExtend<ComponentProps<typeof PageTabs>>();
expectTypeOf<{ href: string; current: boolean }>().toExtend<PageTabProps>();
expectTypeOf<{ asChild: true }>().toExtend<PageTabProps>();
expectTypeOf<{ current: boolean }>().not.toExtend<PageTabProps>();
expectTypeOf<ComponentProps<typeof PageTab>["current"]>().toEqualTypeOf<
  boolean | undefined
>();
