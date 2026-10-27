import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

function WaveBar({ delay, isPlaying, color }: { delay: number; isPlaying: boolean; color: string }) {
  const anim = useRef(new Animated.Value(0.35)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (isPlaying) {
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 1, duration: 380 + delay, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0.25, duration: 380 + delay, useNativeDriver: true }),
        ]),
      );
      loopRef.current.start();
    } else {
      loopRef.current?.stop();
      Animated.timing(anim, { toValue: 0.35, duration: 200, useNativeDriver: true }).start();
    }
    return () => loopRef.current?.stop();
  }, [isPlaying, anim, delay]);

  return (
    <Animated.View style={[styles.bar, { backgroundColor: color, transform: [{ scaleY: anim }] }]} />
  );
}

export default function WaveBars({ isPlaying, color }: { isPlaying: boolean; color: string }) {
  return (
    <View style={styles.row} pointerEvents="none">
      <WaveBar delay={0} isPlaying={isPlaying} color={color} />
      <WaveBar delay={80} isPlaying={isPlaying} color={color} />
      <WaveBar delay={160} isPlaying={isPlaying} color={color} />
      <WaveBar delay={40} isPlaying={isPlaying} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 3 },
  bar: { width: 3, height: 18, borderRadius: 2 },
});
