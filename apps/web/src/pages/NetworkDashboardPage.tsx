import { useEffect, useState } from "react";
import {
  getNetworkDeviceInterfaces,
  getNetworkInterfaceHistory,
  listNetworkDevices,
} from "../lib/monitoringApiClient";
import type { NetworkDevice, NetworkInterfaceSample } from "../types/monitoring";
import { useTenant } from "../lib/tenant";
import NetworkThroughputSparkline from "../components/NetworkThroughputSparkline";

/** Site24x7 network-monitoring-style dashboard: device -> interface table with status + a throughput sparkline per interface. */
export default function NetworkDashboardPage() {
  const { tenantId } = useTenant();
  const [devices, setDevices] = useState<NetworkDevice[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [interfaces, setInterfaces] = useState<NetworkInterfaceSample[]>([]);
  const [historyByIndex, setHistoryByIndex] = useState<Record<number, NetworkInterfaceSample[]>>({});

  useEffect(() => {
    if (!tenantId) return;
    listNetworkDevices(tenantId).then((d) => {
      setDevices(d);
      if (!deviceId && d.length > 0) setDeviceId(d[0].id);
    });
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId || !deviceId) return;
    getNetworkDeviceInterfaces(tenantId, deviceId).then((rows) => {
      setInterfaces(rows);
      Promise.all(
        rows.map((r) => getNetworkInterfaceHistory(tenantId, deviceId, r.if_index, 30).then((h) => [r.if_index, h] as const)),
      ).then((pairs) => setHistoryByIndex(Object.fromEntries(pairs)));
    });
  }, [tenantId, deviceId]);

  if (!tenantId) return <p className="hint">Set a tenant id above to view network monitoring.</p>;

  const device = devices.find((d) => d.id === deviceId);

  return (
    <div>
      <div className="reports-header">
        <h2>Network</h2>
        {devices.length > 0 && (
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.host})
              </option>
            ))}
          </select>
        )}
      </div>

      {devices.length === 0 && (
        <p className="hint">No network devices yet — add one in Admin → Monitor admin → Network devices.</p>
      )}

      {device && (
        <>
          <p className="hint">
            SNMPv{device.snmp_version} · port {device.port} ·{" "}
            {device.last_polled_at ? `last polled ${new Date(device.last_polled_at).toLocaleString()}` : "not polled yet"}
          </p>

          {interfaces.length === 0 && <p className="hint">No interfaces recorded yet for this device.</p>}
          {interfaces.length > 0 && (
            <table className="reports-table">
              <thead>
                <tr>
                  <th>Interface</th>
                  <th>Status</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Throughput</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {interfaces.map((iface) => (
                  <tr key={iface.if_index}>
                    <td>{iface.if_name ?? `if${iface.if_index}`}</td>
                    <td>
                      <span className={`badge status-${iface.oper_status === "up" ? "up" : iface.oper_status === "down" ? "down" : "trouble"}`}>
                        {iface.oper_status}
                      </span>
                    </td>
                    <td>{iface.in_octets.toLocaleString()} B</td>
                    <td>{iface.out_octets.toLocaleString()} B</td>
                    <td>
                      <NetworkThroughputSparkline samples={historyByIndex[iface.if_index] ?? []} />
                    </td>
                    <td className="hint">{new Date(iface.ts).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
