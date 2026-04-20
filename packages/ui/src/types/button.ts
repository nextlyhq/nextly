import type { VariantProps } from "class-variance-authority";
import { ButtonHTMLAttributes } from "react";

import type { buttonVariants } from "../components/button";

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}
