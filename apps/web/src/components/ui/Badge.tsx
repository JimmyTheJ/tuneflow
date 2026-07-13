import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Props = {
  children: ReactNode;
  className?: string;
};

export function Badge({ children, className }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-highlight px-2 py-0.5",
        "text-[0.68rem] font-semibold uppercase tracking-wide text-text-secondary",
        className,
      )}
    >
      {children}
    </span>
  );
}
