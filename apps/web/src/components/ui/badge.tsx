import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide", {
  variants: {
    tone: {
      success: "border-k-success/40 bg-k-success/10 text-k-success",
      warning: "border-k-warning/40 bg-k-warning/10 text-k-warning",
      danger: "border-k-danger/40 bg-k-danger/10 text-k-danger",
      neutral: "border-k-border bg-k-elevated text-k-text",
      lime: "border-k-lime/40 bg-k-lime/10 text-k-lime",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
