import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@revnixhq/ui";

import type { LucideIcon } from "@admin/components/icons";
import * as Icons from "@admin/components/icons";
import { useFields } from "@admin/hooks/useFields";
import { FieldType } from "@admin/types/field-types";

// Icon mapping for dynamic icon rendering
const iconMap = Icons as unknown as Record<string, LucideIcon>;

const categoryColors: Record<string, string> = {
  "Basic Fields": "bg-primary",
  "Content Fields": "bg-green-500",
  "Choice Fields": "bg-purple-500",
  "Relational Fields": "bg-orange-500",
  "Advanced Fields": "bg-red-500",
};

// Mapping from useFields types to FieldType enum
const fieldTypeMapping: Record<string, FieldType> = {
  text: FieldType.TEXT,
  email: FieldType.EMAIL,
  password: FieldType.PASSWORD,
  textarea: FieldType.TEXTAREA,
  number: FieldType.NUMBER,
  richtext: FieldType.RICH_TEXT,
  select: FieldType.SELECT,
  boolean: FieldType.BOOLEAN,
  radio: FieldType.RADIO,
  relation: FieldType.RELATION,
  user: FieldType.USER,
  date: FieldType.DATE_PICKER,
  timepicker: FieldType.TIME_PICKER,
};

interface AddFieldProps {
  onClose?: () => void;
  onFieldSelect?: (fieldType: string) => void;
}

export function AddField({ onClose, onFieldSelect }: AddFieldProps = {}) {
  const fields = useFields();
  return (
    <Dialog open={true} onOpenChange={open => !open && onClose?.()}>
      <DialogContent
        className="sm:max-w-3xl h-[80vh] overflow-auto"
        aria-describedby="delete-dialog-description"
        role="alertdialog"
      >
        <DialogHeader>
          <DialogTitle id="delete-dialog-title" className="text-2xl">
            Select Field Type
          </DialogTitle>
          <DialogDescription
            id="delete-dialog-description"
            className="text-gray-800 text-md"
          >
            Choose the type of field you want to add to your field group
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-6">
          {fields.map((category, categoryIndex) => (
            <div key={categoryIndex}>
              <div className="text-lg font-semibold flex items-center mb-4">
                <div
                  className={`w-2 h-2 ${categoryColors[category.title]} rounded-none mr-3`}
                ></div>
                {category.title}
              </div>

              <div className="grid grid-cols-3 gap-4">
                {category.items.map((item, itemIndex) => {
                  const IconComponent = iconMap[item.icon];
                  return (
                    <div
                      key={itemIndex}
                      className="border border-border shadow rounded-none p-5 cursor-pointer hover:bg-zinc-100"
                      onClick={() => {
                        const mappedType =
                          fieldTypeMapping[item.type] || item.type;
                        onFieldSelect?.(mappedType);
                        onClose?.();
                      }}
                    >
                      <div className="flex items-center gap-3 text-zinc-600">
                        <IconComponent className="w-5 h-5" />
                        <span className="text-black text-sm capitalize">
                          {item.type}
                        </span>
                      </div>
                      <p className="text-sm mt-3 text-zinc-700">
                        {item.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
