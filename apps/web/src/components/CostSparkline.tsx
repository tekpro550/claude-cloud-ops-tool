import type { CostTrendPoint } from "../types/cost";

const BAR_WIDTH = 14;
const BAR_GAP = 6;
const HEIGHT = 40;

/** Minimal trend bars for a cost card — the rollup's "6-7 month trend chart" (scope doc section 6). Full interactive charting lives in TrendsChart for the ticketing dashboard; this is intentionally lighter since it's one of many cards on a page, not a page's sole focus. */
export default function CostSparkline({ data }: { data: CostTrendPoint[] }) {
  if (data.length === 0) {
    return <p className="hint">No trend data yet.</p>;
  }

  const max = Math.max(1, ...data.map((d) => d.total));
  const width = data.length * (BAR_WIDTH + BAR_GAP);

  return (
    <svg
      className="cost-sparkline"
      viewBox={`0 0 ${width} ${HEIGHT}`}
      width={width}
      height={HEIGHT}
      role="img"
      aria-label="Monthly spend trend"
    >
      {data.map((d, i) => {
        const barHeight = (d.total / max) * HEIGHT;
        return (
          <rect
            key={d.month}
            x={i * (BAR_WIDTH + BAR_GAP)}
            y={HEIGHT - barHeight}
            width={BAR_WIDTH}
            height={barHeight}
            rx={2}
            className="cost-sparkline-bar"
          >
            <title>{`${d.month}: $${d.total.toFixed(2)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
