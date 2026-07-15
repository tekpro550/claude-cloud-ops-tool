import { useMemo, useState } from "react";
import type { DashboardTrendPoint } from "../types/ticket";

const BAR_WIDTH = 10;
const BAR_GAP = 2;
const GROUP_GAP = 14;
const GROUP_WIDTH = BAR_WIDTH * 2 + BAR_GAP + GROUP_GAP;
const CHART_HEIGHT = 140;

/**
 * Grouped bar chart: created vs. resolved tickets per day. Palette (blue for
 * created, aqua for resolved) is the dataviz skill's validated default
 * categorical slots 1/2, in fixed order. Aqua fails the 3:1 contrast check on
 * a light surface, so per the skill's "relief rule" this ships a table-view
 * toggle (not just a color-coded chart) rather than relying on hue alone.
 */
export default function TrendsChart({ data }: { data: DashboardTrendPoint[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const maxValue = useMemo(() => {
    const max = Math.max(1, ...data.map((d) => Math.max(d.created, d.resolved)));
    const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
    return Math.ceil(max / magnitude) * magnitude;
  }, [data]);

  const width = data.length * GROUP_WIDTH;
  // Deduped: at low volume (maxValue as small as 1) the midpoint and the max
  // round to the same integer, which would otherwise draw two overlapping
  // gridlines with the same React key.
  const ticks = [...new Set([0, maxValue / 2, maxValue].map((v) => Math.round(v)))];
  const scaleY = (value: number) => (value / maxValue) * CHART_HEIGHT;
  const hovered = hoverIndex !== null ? data[hoverIndex] : null;

  return (
    <div className="trends-chart-root">
      <div className="trends-chart-header">
        <div className="trends-legend">
          <span className="legend-item">
            <span className="legend-swatch swatch-created" /> Created
          </span>
          <span className="legend-item">
            <span className="legend-swatch swatch-resolved" /> Resolved
          </span>
        </div>
        <button type="button" className="link-button" onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Hide table" : "View as table"}
        </button>
      </div>

      {!showTable && (
        <>
          <svg
            className="trends-chart"
            viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
            width="100%"
            height={CHART_HEIGHT}
            role="img"
            aria-label="Tickets created and resolved per day, last 14 days"
          >
            {ticks.map((t) => (
              <line key={t} x1={0} x2={width} y1={CHART_HEIGHT - scaleY(t)} y2={CHART_HEIGHT - scaleY(t)} className="trends-gridline" />
            ))}
            {data.map((d, i) => {
              const x = i * GROUP_WIDTH;
              const createdHeight = scaleY(d.created);
              const resolvedHeight = scaleY(d.resolved);
              return (
                <g
                  key={d.date}
                  onMouseEnter={() => setHoverIndex(i)}
                  onMouseLeave={() => setHoverIndex((h) => (h === i ? null : h))}
                >
                  <rect x={x} y={0} width={GROUP_WIDTH - GROUP_GAP} height={CHART_HEIGHT} fill="transparent" />
                  <rect
                    x={x}
                    y={CHART_HEIGHT - createdHeight}
                    width={BAR_WIDTH}
                    height={createdHeight}
                    rx={3}
                    className={`trends-bar bar-created${hoverIndex === i ? " active" : ""}`}
                  />
                  <rect
                    x={x + BAR_WIDTH + BAR_GAP}
                    y={CHART_HEIGHT - resolvedHeight}
                    width={BAR_WIDTH}
                    height={resolvedHeight}
                    rx={3}
                    className={`trends-bar bar-resolved${hoverIndex === i ? " active" : ""}`}
                  />
                  <title>{`${d.date}: ${d.created} created, ${d.resolved} resolved`}</title>
                </g>
              );
            })}
          </svg>
          <div className="trends-chart-tooltip">
            {hovered ? `${hovered.date} — ${hovered.created} created, ${hovered.resolved} resolved` : "Hover a day for details"}
          </div>
        </>
      )}

      {showTable && (
        <table className="trends-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Created</th>
              <th>Resolved</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.date}>
                <td>{d.date}</td>
                <td>{d.created}</td>
                <td>{d.resolved}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
