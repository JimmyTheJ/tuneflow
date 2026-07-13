import type { ReactNode } from "react";
import { Text, View } from "react-native";

type Props = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
};

export function SectionHeader({ title, subtitle, action, className }: Props) {
  return (
    <View className={`mb-3 flex-row items-end justify-between gap-3 ${className ?? ""}`}>
      <View className="min-w-0 flex-1">
        <Text className="text-xl font-bold tracking-tight text-text">{title}</Text>
        {subtitle ? <Text className="mt-1 text-sm text-text-secondary">{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}
