"use client";

import "@nextlyhq/admin/style.css";
import { RootLayout } from "@nextlyhq/admin";
// Load the page-builder admin components (side-effect: registerComponents). In a real app
// this is done by the generated plugin-admin import map; wired explicitly here. Named
// imports are referenced below so the module is never tree-shaken away.
import {
  PageBuilderEditView,
  PageBuilderField,
} from "@nextlyhq/plugin-page-builder/admin";
import "@nextlyhq/plugin-page-builder/styles/editor.css";
// Load the form-builder admin components (side-effect: registerComponents) + styles.
import "@nextlyhq/plugin-form-builder/admin";
import "@nextlyhq/plugin-form-builder/styles/submissions-filter.css";

// Reference the exports so the registration side-effect module is retained.
void PageBuilderEditView;
void PageBuilderField;

export default function AdminPage() {
  return <RootLayout />;
}
