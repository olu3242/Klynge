import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-k-lime text-k-black hover:bg-k-lime-bright",
        ghost: "border border-k-border bg-k-surface text-k-text hover:border-k-lime",
        subtle: "text-k-secondary hover:text-k-text",
      },
      size: { sm: "min-h-8 px-3 text-xs", md: "" },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

export function Button({ className, variant, size, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
