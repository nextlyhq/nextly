"use client";

/**
 * When a notification sends: on every submission, or only when all, or any,
 * of several conditions hold. Spam is never emailed either way.
 *
 * @module admin/components/notifications/NotificationConditions
 */
import {
  Button,
  FormSection,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { Plus, X } from "lucide-react";
import type { JSX } from "react";

import type {
  AnyFormField,
  ConditionalLogicCondition,
  FormNotification,
} from "../../../types";
import {
  type ConditionMatch,
  conditionsOf,
} from "../../../utils/notification-model";
import { ChoiceCards } from "../builder/settings-rows";

import { COMPARISON_WORDS, VALUELESS } from "./notification-summary";
import type { NotificationUpdate } from "./NotificationRecipients";

const TRIGGER = "w-full bg-transparent border-input dark:bg-muted/50";

/** A field a condition can test: any answer a visitor gives. */
function testable(fields: readonly AnyFormField[]): AnyFormField[] {
  return fields.filter(field => field.type !== "file");
}

function ConditionRow({
  index,
  condition,
  fields,
  onChange,
  onRemove,
}: {
  index: number;
  condition: ConditionalLogicCondition;
  fields: readonly AnyFormField[];
  onChange: (condition: ConditionalLogicCondition) => void;
  onRemove: () => void;
}): JSX.Element {
  const n = index + 1;
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-background p-2 sm:flex-row sm:items-center">
      <Select
        value={condition.field}
        onValueChange={field => onChange({ ...condition, field })}
      >
        <SelectTrigger
          aria-label={`Condition ${n} field`}
          className={`${TRIGGER} sm:w-52`}
        >
          <SelectValue placeholder="Choose a field" />
        </SelectTrigger>
        <SelectContent>
          {fields.map(field => (
            <SelectItem key={field.name} value={field.name}>
              {field.label || field.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={condition.comparison}
        onValueChange={comparison =>
          onChange({
            ...condition,
            comparison: comparison as ConditionalLogicCondition["comparison"],
          })
        }
      >
        <SelectTrigger
          aria-label={`Condition ${n} comparison`}
          className={`${TRIGGER} sm:w-40`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(COMPARISON_WORDS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!VALUELESS.has(condition.comparison) && (
        <Input
          aria-label={`Condition ${n} value`}
          value={
            typeof condition.value === "string" ||
            typeof condition.value === "number"
              ? String(condition.value)
              : condition.value === true
                ? "true"
                : ""
          }
          onChange={event =>
            onChange({ ...condition, value: event.target.value })
          }
          className="sm:flex-1"
        />
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 self-end sm:self-auto"
        aria-label={`Remove condition ${n}`}
        onClick={onRemove}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </li>
  );
}

export function NotificationConditions({
  notification,
  fields,
  update,
}: {
  notification: FormNotification;
  fields: readonly AnyFormField[];
  update: NotificationUpdate;
}): JSX.Element {
  const { match, list } = conditionsOf(notification);
  const choices = testable(fields);
  // Written as the list, the single legacy condition cleared, so the rule
  // reads one way from here on.
  const write = (next: {
    match: ConditionMatch;
    list: ConditionalLogicCondition[];
  }) => update({ conditions: next, condition: undefined });
  const blank = (): ConditionalLogicCondition => ({
    field: choices[0]?.name ?? "",
    comparison: "equals",
    value: "",
  });
  return (
    <FormSection label="When to send">
      <ChoiceCards
        name="notification-when"
        label="When to send"
        value={list.length === 0 ? "always" : "only"}
        onChange={value =>
          write(
            value === "always"
              ? { match, list: [] }
              : { match, list: [blank()] }
          )
        }
        choices={[
          {
            value: "always",
            title: "Every submission",
            description: "Spam is never emailed.",
          },
          {
            value: "only",
            title: "Only when…",
            disabled: choices.length === 0,
            details: (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={match}
                    onValueChange={value =>
                      write({ match: value === "any" ? "any" : "all", list })
                    }
                  >
                    <SelectTrigger
                      aria-label="How conditions combine"
                      className={`${TRIGGER} w-24`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="any">Any</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-muted-foreground">
                    of these are true
                  </span>
                </div>
                <ul aria-label="Conditions" className="flex flex-col gap-2">
                  {list.map((condition, index) => (
                    <ConditionRow
                      key={index}
                      index={index}
                      condition={condition}
                      fields={choices}
                      onChange={next =>
                        write({
                          match,
                          list: list.map((each, i) =>
                            i === index ? next : each
                          ),
                        })
                      }
                      onRemove={() =>
                        write({
                          match,
                          list: list.filter((_, i) => i !== index),
                        })
                      }
                    />
                  ))}
                </ul>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-fit"
                  onClick={() => write({ match, list: [...list, blank()] })}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add condition
                </Button>
              </div>
            ),
          },
        ]}
      />
    </FormSection>
  );
}
