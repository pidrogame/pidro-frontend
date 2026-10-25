import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { PidroGameOver } from '@/design/tokens';

/**
 * Both teams' totals after each hand as two lines, ours gold and theirs
 * coral, against the dashed winning line. `turn` marks the hand after which
 * the winner never stopped leading. Lines only; the caller labels it.
 */
export function RaceChart({
  us,
  them,
  turn,
  target,
  height,
  scale = 1,
}: {
  us: number[];
  them: number[];
  turn: number | null;
  target: number;
  height: number;
  scale?: number;
}) {
  const [width, setWidth] = useState(0);
  const pad = 20 * scale;
  const low = Math.min(0, ...us, ...them);
  const high = Math.max(target, ...us, ...them);
  const steps = Math.max(1, us.length - 1);
  const x = (index: number) => pad + ((width - pad * 2) * index) / steps;
  const y = (score: number) =>
    8 * scale + ((height - 16 * scale) * (high - score)) / (high - low || 1);
  const line = (scores: number[]) => scores.map((score, i) => `${x(i)},${y(score)}`).join(' ');
  const last = us.length - 1;
  const oursWon = us[last] > them[last];

  return (
    <View
      testID="race-chart"
      style={{ height }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Line
            x1={pad}
            y1={y(target)}
            x2={width - pad}
            y2={y(target)}
            stroke={PidroGameOver.target}
            strokeWidth={1}
            strokeDasharray="3 4"
            opacity={0.7}
          />
          <Polyline
            points={line(them)}
            fill="none"
            stroke={PidroGameOver.theirs}
            strokeWidth={2.5 * scale}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={0.85}
          />
          <Polyline
            points={line(us)}
            fill="none"
            stroke={PidroGameOver.ours}
            strokeWidth={3.5 * scale}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {turn != null ? (
            <Circle
              cx={x(turn)}
              cy={y(oursWon ? us[turn] : them[turn])}
              r={4.5 * scale}
              fill={PidroGameOver.markerFill}
              stroke={PidroGameOver.markerEdge}
              strokeWidth={2}
            />
          ) : null}
          {last > 0 ? (
            <Circle
              cx={x(last)}
              cy={y(oursWon ? us[last] : them[last])}
              r={6 * scale}
              fill={oursWon ? PidroGameOver.ours : PidroGameOver.theirs}
              stroke={PidroGameOver.markerEdge}
              strokeWidth={2}
            />
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}
