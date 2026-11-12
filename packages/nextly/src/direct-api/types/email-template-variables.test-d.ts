/**
 * What the email namespace's template inputs may declare.
 *
 * `CreateEmailTemplateArgs.data.variables` once spelled the pre-typing shape
 * inline, so a TypeScript consumer passing a typed declaration (a `type`, a
 * `label`, an `example`, `fields`) failed excess-property checking on the
 * published surface while the service accepted it at runtime. The input now
 * carries the canonical declaration type; this pins that equality and that a
 * fully typed declaration is assignable at both entry points — create
 * directly, and the update's partial of it.
 *
 * @module direct-api/types/email-template-variables.test-d
 */
import { expectTypeOf } from "vitest";

import type { EmailTemplateVariable } from "../../schemas/email-templates/types";
import type { CreateEmailTemplateArgs, UpdateEmailTemplateArgs } from "./email";

expectTypeOf<CreateEmailTemplateArgs["data"]["variables"]>().toEqualTypeOf<
  EmailTemplateVariable[] | undefined
>();

const typedDeclaration = {
  name: "order",
  description: "The order",
  type: "object" as const,
  label: "Order",
  example: { id: "o-1" },
  fields: [{ name: "id" }, { name: "total", type: "money" as const }],
  required: true,
};

// A typed declaration is accepted where a save accepts it.
const create: CreateEmailTemplateArgs["data"] = {
  name: "Order shipped",
  slug: "order-shipped",
  subject: "Your order is on its way",
  htmlContent: "<p>Hi {{order.id}}</p>",
  variables: [typedDeclaration],
};

const update: UpdateEmailTemplateArgs["data"] = {
  variables: [typedDeclaration],
};

void create;
void update;
