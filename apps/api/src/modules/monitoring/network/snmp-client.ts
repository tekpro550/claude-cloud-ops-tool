export interface SnmpInterfaceReading {
  ifIndex: number;
  ifName: string;
  operStatus: 'up' | 'down' | 'unknown';
  inOctets: number;
  outOctets: number;
}

export interface SnmpTarget {
  host: string;
  port: number;
  community: string;
  version: '1' | '2c' | '3';
}

/**
 * One implementation (NetSnmpClient) behind this interface, the same shape
 * as CloudProviderClient/SyntheticRunner in this codebase -- lets
 * NetworkPollerService stay SNMP-library-agnostic and, more importantly,
 * lets it be verified against a fake with no real network device (see
 * scripts/verify-network.ts).
 */
export interface SnmpClient {
  walkInterfaces(target: SnmpTarget): Promise<SnmpInterfaceReading[]>;
}

export const SNMP_CLIENT = Symbol('SNMP_CLIENT');
