import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@revnixhq/ui";
import { useState, useRef } from "react";

import { FIELD_TYPES } from "@admin/constants/field-categories";
import {
  FieldConfig,
  FieldType,
  TextFieldConfig,
  TextAreaFieldConfig,
  NumberFieldConfig,
  SelectFieldConfig,
  BooleanFieldConfig,
  DatePickerFieldConfig,
  FieldEditorDialogProps,
  EmailFieldConfig,
  RadioFieldConfig,
  PasswordFieldConfig,
  UserFieldConfig,
  ChipsFieldConfig,
} from "@admin/types/field-types";

import { BooleanFieldEditor } from "../field-types/BooleanFieldEditor";
import { ChipsFieldEditor } from "../field-types/ChipsFieldEditor";
import { DatePickerFieldEditor } from "../field-types/DatePickerFieldEditor";
import { EmailFieldEditor } from "../field-types/EmailFieldEditor";
import { NumberFieldEditor } from "../field-types/NumberFieldEditor";
import { PasswordFieldEditor } from "../field-types/PasswordFieldEditor";
import { RadioFieldEditor } from "../field-types/RadioFieldEditor";
import { SelectFieldEditor } from "../field-types/SelectFieldEditor";
import { TextAreaFieldEditor } from "../field-types/TextAreaFieldEditor";
import { TextFieldEditor } from "../field-types/TextFieldEditor";
import { UserFieldEditor } from "../field-types/UserFieldEditor";

/**
 * Dialog for adding/editing fields
 * Provides a type selector and renders the appropriate field editor
 */
export function FieldEditorDialog({
  initialData,
  initialFieldType,
  onClose,
  onSave,
  fieldIndex,
}: FieldEditorDialogProps) {
  // Start with initialData type, initialFieldType, or default to TEXT
  const [selectedType, setSelectedType] = useState<FieldType>(
    initialData?.type || initialFieldType || FieldType.TEXT
  );
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  // Only allow the requested field types in this dialog
  const ALLOWED_TYPES: FieldType[] = [
    FieldType.TEXT,
    FieldType.EMAIL,
    FieldType.PASSWORD,
    FieldType.USER,
    FieldType.TEXTAREA,
    FieldType.RICH_TEXT,
    FieldType.NUMBER,
    FieldType.SELECT,
    FieldType.BOOLEAN,
    FieldType.RADIO,
    FieldType.CHIPS,
    FieldType.DATE_PICKER,
  ];

  // Handle field type selection change
  const handleTypeChange = (value: string) => {
    setSelectedType(value as FieldType);
    setIsOpen(false);
  };

  const handleSave = (fieldData: Omit<FieldConfig, "id">) => {
    const fieldId = `field_${fieldIndex}`;
    const updatedField = {
      ...fieldData,
      type: selectedType,
      id: fieldId,
      name: fieldData.name || "",
      label: fieldData.label || "",
    } as FieldConfig;
    onSave(updatedField);
  };

  // Render the appropriate fivn
  // eld editor based on selected type
  const renderFieldEditor = (props?: {
    formRef?: React.RefObject<HTMLFormElement | null>;
  }) => {
    switch (selectedType) {
      case FieldType.TEXT:
        return (
          <TextFieldEditor
            initialData={initialData as Partial<TextFieldConfig>}
            onSubmit={handleSave}
            formRef={props?.formRef}
          />
        );
      case FieldType.EMAIL:
        return (
          <EmailFieldEditor
            initialData={initialData as Partial<EmailFieldConfig>}
            onSubmit={handleSave}
            formRef={props?.formRef}
          />
        );
      case FieldType.PASSWORD:
        return (
          <PasswordFieldEditor
            initialData={initialData as Partial<PasswordFieldConfig>}
            onSubmit={handleSave}
            formRef={props?.formRef}
          />
        );
      case FieldType.TEXTAREA:
        return (
          <TextAreaFieldEditor
            initialData={initialData as Partial<TextAreaFieldConfig>}
            onSubmit={handleSave}
            formRef={props?.formRef}
          />
        );
      case FieldType.NUMBER:
        return (
          <NumberFieldEditor
            initialData={initialData as Partial<NumberFieldConfig>}
            onSubmit={handleSave}
            formRef={props?.formRef}
          />
        );
      case FieldType.USER:
        return (
          <UserFieldEditor
            initialData={initialData as Partial<UserFieldConfig>}
            onSubmit={handleSave}
            formRef={props?.formRef}
          />
        );
      case FieldType.SELECT:
        return (
          <SelectFieldEditor
            initialData={initialData as Partial<SelectFieldConfig>}
            onSubmit={handleSave}
            formRef={props?.formRef}
          />
        );
      case FieldType.BOOLEAN:
        return (
          <BooleanFieldEditor
            initialData={initialData as Partial<BooleanFieldConfig>}
            onSubmit={handleSave}
            formRef={props?.formRef}
          />
        );
      case FieldType.RADIO:
        return (
          <RadioFieldEditor
            initialData={initialData as Partial<RadioFieldConfig>}
            onSubmit={handleSave}
            formRef={props?.formRef}
          />
        );
      case FieldType.CHIPS:
        return (
          <ChipsFieldEditor
            initialData={initialData as Partial<ChipsFieldConfig>}
            onSubmit={handleSave}
            formRef={props?.formRef}
          />
        );
      case FieldType.DATE_PICKER:
        return (
          <DatePickerFieldEditor
            initialData={initialData as Partial<DatePickerFieldConfig>}
            onSubmit={handleSave}
            formRef={props?.formRef}
          />
        );
      case FieldType.RICH_TEXT:
        return (
          <TextAreaFieldEditor
            initialData={initialData as Partial<TextAreaFieldConfig>}
            onSubmit={handleSave}
            formRef={props?.formRef}
          />
        );
      default:
        return (
          <div className="p-4 text-center">
            <p className="text-muted-foreground">
              Unknown field type: {selectedType}
            </p>
          </div>
        );
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="flex flex-col space-y-3">
          <div className="flex items-center justify-between">
            <DialogTitle>
              {initialData ? "Edit Field" : "Add New Field"}
            </DialogTitle>

            {/* Field type selector in header when adding a new field */}
            {!initialData && (
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-muted-foreground">
                  Field Type:
                </span>
                <div className="relative inline-block">
                  <Select
                    value={selectedType}
                    onValueChange={handleTypeChange}
                    open={isOpen}
                    onOpenChange={setIsOpen}
                  >
                    <SelectTrigger
                      className="w-[180px] h-8 bg-background"
                      ref={triggerRef}
                      onClick={() => setIsOpen(true)}
                    >
                      <SelectValue placeholder="Select field type">
                        {FIELD_TYPES[selectedType]?.label || selectedType}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent
                      position="popper"
                      className="bg-popover border-border shadow-xl"
                      sideOffset={5}
                      align="start"
                    >
                      {ALLOWED_TYPES.map(typeKey => {
                        const def = FIELD_TYPES[typeKey];
                        return (
                          <SelectItem
                            key={def.type}
                            value={def.type}
                            className="cursor-pointer hover:bg-accent hover:text-accent-foreground"
                          >
                            {def.label}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          {/* Show description of selected field type */}
          {!initialData && (
            <DialogDescription>
              {FIELD_TYPES[selectedType]?.description ||
                "Configure field properties below"}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="py-4">
          {/* Field configuration area */}
          {renderFieldEditor({ formRef })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              const form = formRef.current;
              if (form) {
                if (
                  typeof (
                    form as HTMLFormElement & { requestSubmit?: () => void }
                  ).requestSubmit === "function"
                ) {
                  (
                    form as HTMLFormElement & { requestSubmit?: () => void }
                  ).requestSubmit();
                } else {
                  form.dispatchEvent(
                    new Event("submit", { bubbles: true, cancelable: true })
                  );
                }
              }
            }}
          >
            {initialData ? "Save Changes" : "Add Field"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
