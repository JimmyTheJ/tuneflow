import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, type PressableProps } from "react-native";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

type Props = PressableProps & {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  loading?: boolean;
  children: ReactNode;
};

const variantClass: Record<Variant, string> = {
  primary: "bg-accent active:bg-accent-hover",
  secondary: "bg-highlight border border-border active:bg-hover",
  ghost: "bg-transparent active:bg-highlight",
  danger: "bg-danger-bg active:opacity-90",
};

const textClass: Record<Variant, string> = {
  primary: "text-accent-fg font-bold",
  secondary: "text-text font-semibold",
  ghost: "text-text-secondary font-semibold",
  danger: "text-danger-fg font-semibold",
};

const sizeClass: Record<Size, string> = {
  sm: "px-3 py-2 rounded-full",
  md: "px-4 py-3 rounded-full",
  lg: "px-6 py-3.5 rounded-full",
};

const textSizeClass: Record<Size, string> = {
  sm: "text-sm",
  md: "text-sm",
  lg: "text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: Props & { className?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      className={`items-center justify-center ${variantClass[variant]} ${sizeClass[size]} ${block ? "w-full" : ""} ${disabled || loading ? "opacity-50" : ""} ${className ?? ""}`}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? "#052e16" : "#fff"} />
      ) : typeof children === "string" ? (
        <Text className={`${textClass[variant]} ${textSizeClass[size]}`}>{children}</Text>
      ) : (
        children
      )}
    </Pressable>
  );
}
