import type { VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import type { buttonVariants } from "../components/button";

/** @public */
export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}
