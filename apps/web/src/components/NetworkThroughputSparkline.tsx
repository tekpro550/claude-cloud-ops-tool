import type { NetworkInterfaceSample } from "../types/monitoring";

interface ThroughputPoint {
  inBps: number;
}

/** Same delta-octets/delta-time calc as the backend's network-throughput.ts, kept small enough to duplicate for a display-only sparkline. */
function computeThroughputSeries(samples: NetworkInterfaceSample[]): ThroughputPoint[] {
  const points: ThroughputPoint[] = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    const deltaSeconds = (new Date(curr.ts).getTime() - new Date(prev.ts).getTime()) / 1000;
    const inDelta = curr.in_octets - prev.in_octets;
    if (deltaSeconds <= 0 || inDelta < 0) continue;
    points.push({ inBps: (inDelta * 8) / deltaSeconds });
  }
  return points;
}

/** A tiny bar sparkline of inbound throughput over an interface's recent samples. */
export default function NetworkThroughputSparkline({ samples }: { samples: NetworkInterfaceSample[] }) {
  const points = computeThroughputSeries(samples);
  if (points.length === 0) return <span className="hint">not enough data</span>;
  const max = Math.max(1, ...points.map((p) => p.inBps));

  return (
    <span className="network-sparkline" title={`${Math.round(points[points.length - 1].inBps / 1000)} kbps latest`}>
      {points.map((p, i) => (
        <span key={i} className="network-sparkline-bar" style={{ height: `${Math.max(8, (p.inBps / max) * 100)}%` }} />
      ))}
    </span>
  );
}
