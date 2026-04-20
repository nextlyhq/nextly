export interface UserDeleteDialogProps {
  open: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  user: {
    id: string;
    name: string;
  } | null;
  isLoading?: boolean;
}
