import { Logger } from '@nestjs/common';
import { SnmpClient, SnmpInterfaceReading, SnmpTarget } from './snmp-client';

// The standard IF-MIB ifTable (1.3.6.1.2.1.2.2.1) column sub-identifiers
// this client reads. net-snmp's generic .table() indexes columns by their
// last OID sub-identifier (a number, not a friendly name), so these map
// straight to IF-MIB's own column numbers.
const IF_TABLE_OID = '1.3.6.1.2.1.2.2.1';
const COL_IF_DESCR = '2';
const COL_IF_OPER_STATUS = '8';
const COL_IF_IN_OCTETS = '10';
const COL_IF_OUT_OCTETS = '16';
// IF-MIB ifOperStatus: 1=up, 2=down, everything else (testing/unknown/
// dormant/notPresent/lowerLayerDown) is treated as 'unknown' here -- this
// platform only distinguishes up/down/unknown, not IF-MIB's full state set.
const OPER_STATUS_UP = 1;
const OPER_STATUS_DOWN = 2;

/**
 * Real backend: SNMP GET/WALK against the standard IF-MIB ifTable. Loaded
 * lazily (require in walkInterfaces()) so the app still boots if the
 * `net-snmp` package or a target device is unreachable -- in that case
 * NetworkPollerService logs and skips that device's tick rather than
 * crashing.
 */
export class NetSnmpClient implements SnmpClient {
  private readonly logger = new Logger(NetSnmpClient.name);

  async walkInterfaces(target: SnmpTarget): Promise<SnmpInterfaceReading[]> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const snmp = require('net-snmp');
    const session = snmp.createSession(target.host, target.community, {
      port: target.port,
      version: target.version === '1' ? snmp.Version1 : snmp.Version2c,
      timeout: 5000,
    });

    try {
      return await new Promise<SnmpInterfaceReading[]>((resolve, reject) => {
        session.table(
          IF_TABLE_OID,
          (
            error: Error | null,
            table?: Record<string, Record<number, unknown>>,
          ) => {
            if (error || !table) {
              reject(error ?? new Error('SNMP table walk returned no data'));
              return;
            }
            const descrByIndex = table[COL_IF_DESCR] ?? {};
            const statusByIndex = table[COL_IF_OPER_STATUS] ?? {};
            const inByIndex = table[COL_IF_IN_OCTETS] ?? {};
            const outByIndex = table[COL_IF_OUT_OCTETS] ?? {};

            const readings: SnmpInterfaceReading[] = Object.keys(
              statusByIndex,
            ).map((indexStr) => {
              const ifIndex = Number(indexStr);
              const status = Number(statusByIndex[ifIndex]);
              return {
                ifIndex,
                ifName: String(descrByIndex[ifIndex] ?? `if${ifIndex}`),
                operStatus:
                  status === OPER_STATUS_UP
                    ? 'up'
                    : status === OPER_STATUS_DOWN
                      ? 'down'
                      : 'unknown',
                inOctets: Number(inByIndex[ifIndex] ?? 0),
                outOctets: Number(outByIndex[ifIndex] ?? 0),
              };
            });
            resolve(readings);
          },
        );
      });
    } finally {
      session.close();
    }
  }
}
