import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { formatTime } from "@/utils/formatTime";
import { useThemeContext } from "@/contexts/ThemeContext";
import type { ThemeColors } from "@/constants/theme";

const TRACK_H = 4;
const HIT_H = 32;
const THUMB_R = 6;
const THUMB_R_ACT = 8;

interface SeekBarProps {
  positionMs: number;
  durationMs: number;
  onSeek: (ms: number) => void;
}

export default function SeekBar({ positionMs, durationMs, onSeek }: SeekBarProps) {
  const { theme: palette } = useThemeContext();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const [isSeeking, setIsSeeking] = useState(false);
  const seekValueRef = useRef(0);
  const isSeekingRef = useRef(false);
  const trackWidthRef = useRef(0);

  const thumbX = useRef(new Animated.Value(0)).current;
  const fillW = useRef(new Animated.Value(0)).current;

  // Sync animated position with live playback when not dragging
  useEffect(() => {
    if (isSeekingRef.current || trackWidthRef.current === 0 || durationMs <= 0) return;
    const x = Math.min(positionMs / durationMs, 1) * trackWidthRef.current;
    thumbX.setValue(x);
    fillW.setValue(x);
  }, [positionMs, durationMs, thumbX, fillW]);

  const seekGesture = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => {
      if (trackWidthRef.current === 0) return;
      const val = Math.max(0, Math.min(1, e.x / trackWidthRef.current));
      seekValueRef.current = val;
      isSeekingRef.current = true;
      thumbX.setValue(val * trackWidthRef.current);
      fillW.setValue(val * trackWidthRef.current);
      setIsSeeking(true);
    })
    .onUpdate((e) => {
      if (trackWidthRef.current === 0) return;
      const val = Math.max(0, Math.min(1, e.x / trackWidthRef.current));
      seekValueRef.current = val;
      thumbX.setValue(val * trackWidthRef.current);
      fillW.setValue(val * trackWidthRef.current);
    })
    .onEnd(() => {
      if (durationMs > 0) onSeek(seekValueRef.current * durationMs);
      isSeekingRef.current = false;
      setIsSeeking(false);
    })
    .onFinalize(() => {
      isSeekingRef.current = false;
      setIsSeeking(false);
    });

  const displayMs = isSeeking ? seekValueRef.current * durationMs : positionMs;
  const thumbR = isSeeking ? THUMB_R_ACT : THUMB_R;

  return (
    <View>
      <GestureDetector gesture={seekGesture}>
        <View
          style={styles.track}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            trackWidthRef.current = w;
            if (!isSeekingRef.current && durationMs > 0) {
              const x = Math.min(positionMs / durationMs, 1) * w;
              thumbX.setValue(x);
              fillW.setValue(x);
            }
          }}
        >
          <View style={styles.rail} />
          <Animated.View style={[styles.fill, { width: fillW }]} />
          <Animated.View
            style={[
              styles.thumb,
              {
                width: thumbR * 2,
                height: thumbR * 2,
                borderRadius: thumbR,
                top: (HIT_H - thumbR * 2) / 2,
                left: Animated.subtract(thumbX, thumbR),
              },
            ]}
          />
        </View>
      </GestureDetector>
      <View style={styles.labels}>
        <Text style={styles.label}>{formatTime(displayMs)}</Text>
        <Text style={styles.label}>{formatTime(durationMs)}</Text>
      </View>
    </View>
  );
}

function createStyles(palette: ThemeColors) {
  return StyleSheet.create({
    track: {
      height: HIT_H,
      width: "100%",
      justifyContent: "center",
    },
    rail: {
      position: "absolute",
      left: 0,
      right: 0,
      height: TRACK_H,
      borderRadius: TRACK_H / 2,
      backgroundColor: palette.border,
    },
    fill: {
      position: "absolute",
      left: 0,
      height: TRACK_H,
      borderRadius: TRACK_H / 2,
      backgroundColor: palette.accent,
    },
    thumb: {
      position: "absolute",
      backgroundColor: palette.accent,
    },
    labels: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 2,
    },
    label: {
      fontFamily: "Inter_400Regular",
      fontSize: 11,
      color: palette.textMuted,
    },
  });
}
