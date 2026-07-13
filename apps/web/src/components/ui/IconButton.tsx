import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
  size?: "sm" | "md" | "lg";
  children: ReactNode;
};

const sizeClass = {
  sm: "size-8",
  md: "size-10",
  lg: "size-12",
};

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { label, active = false, size = "md", className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      className={cn(
        "relative inline-flex items-center justify-center rounded-full transition-all duration-150 cursor-pointer border-0 bg-transparent",
        "text-text-secondary hover:text-text hover:scale-105",
        "disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:scale-100",
        active && "text-accent hover:text-accent-hover",
        sizeClass[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
