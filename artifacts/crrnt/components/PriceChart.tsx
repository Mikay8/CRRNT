import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import palette from "@/constants/colors";

export interface PricePoint {
  date: string;
  close: number;
}

interface PriceChartProps {
  points: PricePoint[];
  width: number;
  height?: number;
  positive?: boolean;
}

export function PriceChart({ points, width, height = 160, positive = true }: PriceChartProps) {
  const chart = useMemo(() => buildChart(points, width, height), [points, width, height]);
  const stroke = positive ? palette.accent : palette.negative;
  const fillId = positive ? "crrntFillPos" : "crrntFillNeg";

  if (!chart) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <Text style={styles.emptyText}>No price data</Text>
      </View>
    );
  }

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={stroke} stopOpacity={0.35} />
            <Stop offset="1" stopColor={stroke} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Path d={chart.areaPath} fill={`url(#${fillId})`} />
        <Path
          d={chart.linePath}
          stroke={stroke}
          strokeWidth={2}
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

interface ChartPaths {
  linePath: string;
  areaPath: string;
}

function buildChart(points: PricePoint[], width: number, height: number): ChartPaths | null {
  if (!points || points.length < 2) return null;
  const closes = points.map((p) => p.close).filter((c) => Number.isFinite(c));
  if (closes.length < 2) return null;

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const padX = 4;
  const padY = 8;
  const usableW = width - padX * 2;
  const usableH = height - padY * 2;

  const xStep = usableW / (closes.length - 1);

  const xy = closes.map((c, i) => {
    const x = padX + i * xStep;
    const y = padY + usableH - ((c - min) / range) * usableH;
    return { x, y };
  });

  const linePath = xy
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");

  const last = xy[xy.length - 1];
  const first = xy[0];
  const areaPath = `${linePath} L${last.x.toFixed(2)},${(padY + usableH).toFixed(2)} L${first.x.toFixed(2)},${(padY + usableH).toFixed(2)} Z`;

  return { linePath, areaPath };
}

const styles = StyleSheet.create({
  empty: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceHigh,
    borderRadius: 12,
  },
  emptyText: {
    fontFamily: "Inter_500Medium",
    color: palette.textDim,
    fontSize: 13,
  },
});

export default PriceChart;
