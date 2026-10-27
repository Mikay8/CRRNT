import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { formatTime } from "@/utils/formatTime";

const TRACK_HIT = 28;
const BAR_HEIGHT = 4;
const KNOB = 14;
const KNOB_ACTIVE = 18;

const clamp = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Full-player seek bar. Holds the dragged / tapped position until playback
 * catches up so the knob doesn't jump back while the seek is in flight.
 */
export default function Scrubber({
  positionMs,
  durationMs,
  seekTo,
  fillColor,
  railColor,
  labelColor,
}: {
  positionMs: number;
  durationMs: number;
  seekTo: (ms: number) => Promise<void>;
  fillColor: string;
  railColor: string;
  labelColor: string;
}) {
  const [scrub, setScrub] = useState<number | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const trackWidthRef = useRef(0);
  const scrubRef = useRef<number | null>(null);
  const holdRef = useRef<number | null>(null);
  const durationRef = useRef(durationMs);
  const seekRef = useRef(seekTo);

  useEffect(() => { durationRef.current = durationMs; }, [durationMs]);
  useEffect(() => { seekRef.current = seekTo; }, [seekTo]);

  const commit = (p: number) => {
    if (durationRef.current <= 0) return;
    holdRef.current = p;
    seekRef.current(p * durationRef.current).catch(() => undefined);
  };

  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e, success) => {
      if (!success || trackWidthRef.current === 0) return;
      commit(clamp(e.x / trackWidthRef.current));
    });

  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-3, 3])
    .failOffsetY([-12, 12])
    .onBegin((e) => {
      if (trackWidthRef.current === 0) return;
      scrubRef.current = clamp(e.x / trackWidthRef.current);
      setScrub(scrubRef.current);
    })
    .onUpdate((e) => {
      if (trackWidthRef.current === 0) return;
      scrubRef.current = clamp(e.x / trackWidthRef.current);
      setScrub(scrubRef.current);
    })
    .onEnd(() => {
      if (scrubRef.current !== null) commit(scrubRef.current);
    })
    .onFinalize(() => {
      scrubRef.current = null;
      setScrub(null);
    });

  const live = durationMs > 0 ? positionMs / durationMs : 0;
  if (holdRef.current !== null && durationMs > 0) {
    if (Math.abs(positionMs - holdRef.current * durationMs) < 1500) holdRef.current = null;
  }
  const progress = scrub ?? holdRef.current ?? live;
  const shownMs = progress * durationMs;
  const knob = scrub !== null ? KNOB_ACTIVE : KNOB;

  return (
    <View>
      <GestureDetector gesture={Gesture.Race(tap, pan)}>
        <View
          style={styles.track}
          onLayout={(e) => {
            trackWidthRef.current = e.nativeEvent.layout.width;
            setTrackWidth(e.nativeEvent.layout.width);
          }}
        >
          <View style={[styles.rail, { backgroundColor: railColor }]} />
          <View style={[styles.fill, { width: progress * trackWidth, backgroundColor: fillColor }]} />
          {trackWidth > 0 ? (
            <View
              style={[
                styles.knob,
                {
                  width: knob,
                  height: knob,
                  borderRadius: knob / 2,
                  top: (TRACK_HIT - knob) / 2,
                  left: progress * trackWidth - knob / 2,
                  backgroundColor: fillColor,
                },
              ]}
            />
          ) : null}
        </View>
      </GestureDetector>
      <View style={styles.times}>
        <Text style={[styles.time, { color: labelColor }]}>{formatTime(shownMs)}</Text>
        <Text style={[styles.time, { color: labelColor }]}>
          -{formatTime(Math.max(0, durationMs - shownMs))}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: TRACK_HIT, justifyContent: "center" },
  rail: { position: "absolute", left: 0, right: 0, height: BAR_HEIGHT, borderRadius: 2 },
  fill: { position: "absolute", left: 0, height: BAR_HEIGHT, borderRadius: 2 },
  knob: {
    position: "absolute",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  times: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  time: { fontFamily: "Inter_500Medium", fontSize: 12, fontVariant: ["tabular-nums"] },
});
