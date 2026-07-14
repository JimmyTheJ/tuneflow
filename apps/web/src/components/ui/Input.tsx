import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-xl border border-border bg-elevated px-3.5 py-3 text-text",
          "placeholder:text-text-muted",
          "transition-colors focus:border-accent focus:outline-none",
          "disabled:opacity-50",
          className,
        )}
        {...rest}
      />
    );
  },
);

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full min-h-20 resize-y rounded-xl border border-border bg-elevated px-3.5 py-3 text-text",
        "placeholder:text-text-muted",
        "transition-colors focus:border-accent focus:outline-none",
        "disabled:opacity-50",
        className,
      )}
      {...rest}
    />
  );
}
