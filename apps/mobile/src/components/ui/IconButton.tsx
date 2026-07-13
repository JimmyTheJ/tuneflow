import { Ionicons } from "@expo/vector-icons";
import { Pressable, type PressableProps } from "react-native";

type Props = PressableProps & {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  size?: "sm" | "md" | "lg";
  active?: boolean;
  color?: string;
  iconSize?: number;
  className?: string;
};

const boxSize = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
};

const defaultIconSize = {
  sm: 18,
  md: 22,
  lg: 26,
};

export function IconButton({
  name,
  label,
  size = "md",
  active = false,
  color,
  iconSize,
  disabled,
  className,
  ...rest
}: Props) {
  const tint = color ?? (active ? "#1db954" : "#b3b3b3");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: active }}
      disabled={disabled}
      className={`items-center justify-center rounded-full active:opacity-70 ${boxSize[size]} ${disabled ? "opacity-35" : ""} ${className ?? ""}`}
      hitSlop={8}
      {...rest}
    >
      <Ionicons name={name} size={iconSize ?? defaultIconSize[size]} color={tint} />
    </Pressable>
  );
}
