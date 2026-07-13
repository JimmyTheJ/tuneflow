import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Props = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  hover?: boolean;
};

export function Card({ children, className, hover = false, ...rest }: Props) {
  return (
    <div
      className={cn(
        "rounded-xl bg-elevated p-4 border border-border/60",
        hover && "transition-colors hover:bg-highlight",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
