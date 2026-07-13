import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  children: ReactNode;
};

const variantClass: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg font-bold hover:bg-accent-hover hover:scale-[1.02] active:scale-[0.98]",
  secondary:
    "bg-highlight text-text font-semibold hover:bg-hover border border-border",
  ghost: "bg-transparent text-text-secondary hover:text-text hover:bg-highlight",
  danger: "bg-danger-bg text-danger-fg font-semibold hover:brightness-110",
};

const sizeClass: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm rounded-full",
  md: "px-4 py-2.5 text-sm rounded-full",
  lg: "px-6 py-3.5 text-base rounded-full",
};

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 transition-all duration-150 cursor-pointer border-0",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100",
        variantClass[variant],
        sizeClass[size],
        block && "w-full",
        className,
      )}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}
