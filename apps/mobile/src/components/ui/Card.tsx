import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";

type Props = ViewProps & {
  children: ReactNode;
  className?: string;
};

export function Card({ children, className, ...rest }: Props) {
  return (
    <View className={`rounded-xl border border-border/60 bg-elevated p-4 ${className ?? ""}`} {...rest}>
      {children}
    </View>
  );
}
