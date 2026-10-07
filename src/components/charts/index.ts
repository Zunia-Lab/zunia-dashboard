/**
 * Zunia chart kit: in-house SVG charts on d3 scales and shapes.
 *
 * Every chart is a client component, as wide as its container, with a fixed
 * height that includes its axis band, a role="img" summary, keyboard
 * exploration, `pending` (refetch: keep the frame, dim it) and `loading`
 * (first load: skeleton) states. Colours come from `src/styles/viz.css`
 * through the palette helpers; formatting comes from the caller.
 *
 * The kit does not draw cards: the UI kit wraps charts in them.
 */

export { AreaChart, type AreaChartProps } from "./AreaChart";
export { BarChart, type BarChartProps, type BarDatum, type BarSeries } from "./BarChart";
export { BarList, type BarListItem, type BarListProps } from "./BarList";
export { ChartTable, type ChartTableColumn, type ChartTableProps } from "./ChartTable";
export { ChartTooltip, type ChartTooltipProps, type TooltipRow } from "./ChartTooltip";
export { Donut, type DonutProps } from "./Donut";
export {
  Legend,
  LegendList,
  Swatch,
  type LegendItem,
  type LegendListItem,
  type LegendListProps,
  type LegendProps,
  type SwatchKind,
} from "./Legend";
export { LineChart, type LineChartProps, type LineSeries } from "./LineChart";
export {
  Meter,
  meterLevel,
  type MeterLevel,
  type MeterProps,
  type MeterThresholds,
} from "./Meter";
export { Sparkline, type SparklineProps } from "./Sparkline";
export { StackedBar, type StackedBarProps } from "./StackedBar";
export { useChartSize, type ChartSize } from "./useChartSize";

export type { TickContext, TickFormatter, YDomain } from "./cartesian";
export {
  affixUnit,
  formatCompact,
  formatShare,
  formatSignedPercent,
  formatValue,
  makeTickFormat,
} from "./format";
export {
  colorFor,
  OTHER_ID,
  stableColorMap,
  VIZ_ACCENT,
  VIZ_ACCENT_2,
  VIZ_NEG,
  VIZ_NEUTRAL,
  VIZ_OTHER,
  VIZ_POS,
  VIZ_SLOT_COUNT,
  VIZ_SLOTS,
  VIZ_WARN,
} from "./palette";
export {
  cleanSeries,
  colouredParts,
  foldOther,
  mergeHuelessParts,
  rebaseToIndex,
  relativeChange,
  valueExtent,
  type FoldedParts,
  type IndexedSeries,
  type PartDatum,
  type TimePoint,
} from "./series";
export {
  nearestIndex,
  niceTicks,
  pointDateFormatter,
  prefersUtc,
  timeTickFormatter,
  timeTicks,
  type LinearTicks,
  type TimeTicks,
  type TimeTickUnit,
  type TimeZoneMode,
} from "./ticks";
