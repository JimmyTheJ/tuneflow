import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Props = ViewProps & {
  children: ReactNode;
  edges?: ("top" | "bottom" | "left" | "right")[];
  padded?: boolean;
  className?: string;
};

export function Screen({
  children,
  edges = ["left", "right"],
  padded = true,
  className,
  ...rest
}: Props) {
  return (
    <SafeAreaView edges={edges} className={`flex-1 bg-base ${className ?? ""}`} {...rest}>
      <View className={`flex-1 ${padded ? "px-4 pt-2" : ""}`}>{children}</View>
    </SafeAreaView>
  );
}
