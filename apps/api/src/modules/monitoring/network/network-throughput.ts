/**
 * Pure per-interface throughput calculation: delta octets / delta time,
 * converted to bits per second. Counters can wrap (32-bit ifInOctets/
 * ifOutOctets roll over at ~4GB) or reset on a device reboot -- either
 * shows up here as a negative delta, which is reported as "unknown"
 * (null) rather than a nonsensical negative rate. Devices exposing 64-bit
 * ifHCInOctets/ifHCOutOctets counters avoid wrapping in practice; this is a
 * disclosed limitation for 32-bit-only devices under sustained high
 * throughput.
 */

export interface ThroughputSample {
  ts: string;
  inOctets: number;
  outOctets: number;
}

export interface Throughput {
  inBps: number;
  outBps: number;
}

export function computeThroughput(
  previous: ThroughputSample,
  current: ThroughputSample,
): Throughput | null {
  const deltaSeconds =
    (new Date(current.ts).getTime() - new Date(previous.ts).getTime()) / 1000;
  if (deltaSeconds <= 0) return null;

  const inDelta = current.inOctets - previous.inOctets;
  const outDelta = current.outOctets - previous.outOctets;
  if (inDelta < 0 || outDelta < 0) return null;

  return {
    inBps: (inDelta * 8) / deltaSeconds,
    outBps: (outDelta * 8) / deltaSeconds,
  };
}
