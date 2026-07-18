import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import { createNetworkDevice, deleteNetworkDevice, listNetworkDevices } from "../../lib/monitoringApiClient";
import type { NetworkDevice, SnmpVersion } from "../../types/monitoring";
import { useConfirm } from "../useConfirm";

/** The SNMP community string is never re-displayed once submitted -- see NetworkDevicesService, it's write-only from here on. */
export default function NetworkDevicesAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [devices, setDevices] = useState<NetworkDevice[]>([]);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [snmpVersion, setSnmpVersion] = useState<SnmpVersion>("2c");
  const [community, setCommunity] = useState("");
  const [port, setPort] = useState("161");
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const load = () => {
    listNetworkDevices(tenantId).then(setDevices);
  };

  useEffect(load, [tenantId]);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !host.trim() || !community.trim()) return;
    setError(null);
    createNetworkDevice(tenantId, {
      name: name.trim(),
      host: host.trim(),
      snmpVersion,
      community: community.trim(),
      port: Number(port) || 161,
    })
      .then(() => {
        setName("");
        setHost("");
        setCommunity("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create network device"));
  };

  const handleDelete = (device: NetworkDevice) => {
    deleteNetworkDevice(tenantId, device.id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete network device"));
  };

  return (
    <div className="admin-entity">
      <h4>Network devices</h4>
      <p className="hint">SNMP-polled routers/switches -- interface up/down and throughput on {"/monitoring/network"}.</p>
      {error && <p className="error">{error}</p>}
      {devices.length === 0 && <p className="hint">No network devices yet.</p>}
      {devices.length > 0 && (
        <ul className="admin-list">
          {devices.map((d) => (
            <li key={d.id}>
              <span>
                <strong>{d.name}</strong> <span className="hint">({d.host}:{d.port}, SNMPv{d.snmp_version})</span>{" "}
                {d.last_polled_at ? (
                  <span className="hint">· last polled {new Date(d.last_polled_at).toLocaleString()}</span>
                ) : (
                  <span className="hint">· not polled yet</span>
                )}
              </span>
              <span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    confirm({
                      title: "Delete network device",
                      message: `Delete “${d.name}”? Its interface history will be removed.`,
                      onConfirm: () => handleDelete(d),
                    })
                  }
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form className="admin-form" onSubmit={handleCreate}>
        <input placeholder="Device name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder="Host / IP" value={host} onChange={(e) => setHost(e.target.value)} required />
        <select value={snmpVersion} onChange={(e) => setSnmpVersion(e.target.value as SnmpVersion)}>
          <option value="1">SNMPv1</option>
          <option value="2c">SNMPv2c</option>
        </select>
        <input placeholder="Community string" value={community} onChange={(e) => setCommunity(e.target.value)} required />
        <label className="side-panel-toggle" title="SNMP agent port (default 161)">
          Port
          <input type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} style={{ width: "5rem" }} />
        </label>
        <button type="submit">Add device</button>
      </form>
      {confirmDialog}
    </div>
  );
}
