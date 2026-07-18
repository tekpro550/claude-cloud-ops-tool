import {
  SnmpClient,
  SnmpInterfaceReading,
  SnmpTarget,
} from '../network/snmp-client';

/**
 * In-memory stand-in for NetSnmpClient, used only by verify-network.ts.
 * Scripts each poll's readings up front (setReadings) so
 * NetworkPollerService's actual logic (sample writes, throughput-relevant
 * history, up->down transition detection) can be verified deterministically
 * with no real SNMP device.
 */
export class FakeSnmpClient implements SnmpClient {
  // Keyed by host -- multiple devices (possibly across tenants) share one
  // fake instance in a verify run, so readings must be scoped per-target or
  // an unrelated device would silently pick up another device's script.
  private readingsByHost = new Map<string, SnmpInterfaceReading[]>();

  setReadings(host: string, readings: SnmpInterfaceReading[]): void {
    this.readingsByHost.set(host, readings);
  }

  async walkInterfaces(target: SnmpTarget): Promise<SnmpInterfaceReading[]> {
    return this.readingsByHost.get(target.host) ?? [];
  }
}
