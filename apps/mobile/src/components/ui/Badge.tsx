import type { ReactNode } from "react";
import { Text } from "react-native";

type Props = {
  children: ReactNode;
  className?: string;
};

export function Badge({ children, className }: Props) {
  return (
    <Text
      className={`rounded-full bg-highlight px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-secondary ${className ?? ""}`}
    >
      {children}
    </Text>
  );
}
