import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Props = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
};

export function SectionHeader({ title, subtitle, action, className }: Props) {
  return (
    <div className={cn("mb-4 flex items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <h2 className="m-0 text-xl font-bold tracking-tight text-text">{title}</h2>
        {subtitle ? <p className="mt-1 mb-0 text-sm text-text-secondary">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
