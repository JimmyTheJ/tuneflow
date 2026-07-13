import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";

type Props = {
  className?: string;
};

export function Skeleton({ className }: Props) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={{ opacity }} className={`rounded-md bg-highlight ${className ?? ""}`} />;
}

export function TrackRowSkeleton() {
  return (
    <View className="flex-row items-center gap-3 px-1 py-2">
      <Skeleton className="h-[52px] w-[52px] rounded-md" />
      <View className="flex-1 gap-2">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </View>
      <Skeleton className="h-3 w-10" />
    </View>
  );
}

export function MediaCardSkeleton() {
  return (
    <View className="gap-3">
      <Skeleton className="aspect-square w-full rounded-lg" />
      <Skeleton className="h-3.5 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </View>
  );
}
