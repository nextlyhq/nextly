import { Can, useCan, type CanProps } from "@nextlyhq/plugin-sdk/client";

// useCan takes a permission slug and returns a boolean.
const allowed: boolean = useCan("manage-seo");

// Can is a component accepting { permission, fallback?, children }.
const props: CanProps = { permission: "manage-seo", children: null };

// Exported so eslint does not flag the assertions as unused.
export const __clientTypeCheck = { Can, allowed, props };
