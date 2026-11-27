"use client";

import { useEffect, useState, type FormEvent } from "react";
import { RoundedSelect } from "@/components/rounded-select";

type KioskOutlet = { id: string; code: string; name: string };
type KioskDevice = {
  id: string;
  outletId: string;
  outletCode: string;
  outletName: string;
  label: string;
  active: boolean;
  hasPin: boolean;
  canShowPin: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

async function responseJson(response: Response) {
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? "Unable to complete kiosk request.");
  return body;
}

export function KioskDeviceManager() {
  const [outlets, setOutlets] = useState<KioskOutlet[]>([]);
  const [devices, setDevices] = useState<KioskDevice[]>([]);
  const [outletId, setOutletId] = useState("");
  const [label, setLabel] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newPinDevice, setNewPinDevice] = useState("");
  const [editingDeviceId, setEditingDeviceId] = useState("");
  const [editingLabel, setEditingLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    const response = await fetch("/api/kiosk/devices", { cache: "no-store" });
    const result = await responseJson(response);
    setDevices(result.devices);
    setOutlets(result.outlets);
    setOutletId((current: string) => current || result.outlets[0]?.id || "");
  }

  useEffect(() => {
    queueMicrotask(() => {
      void load().catch((caught: unknown) =>
        setError(
          caught instanceof Error ? caught.message : "Unable to load kiosks.",
        ),
      );
    });
  }, []);

  async function createDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setNewPin("");
    setBusy(true);
    try {
      const response = await fetch("/api/kiosk/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outletId, label }),
      });
      const result = await responseJson(response);
      setNewPin(result.pin);
      setNewPinDevice(`${result.device.label} · ${result.device.outletCode}`);
      setLabel("");
      setSuccess(
        `Created ${result.device.label} for ${result.device.outletCode}. Give this PIN to the assigned kiosk.`,
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to create kiosk.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteDevice(device: KioskDevice) {
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      const response = await fetch(`/api/kiosk/devices/${device.id}`, {
        method: "DELETE",
      });
      await responseJson(response);
      setSuccess(`${device.label} was deleted. Its saved kiosk session no longer works.`);
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to delete kiosk.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function showPin(device: KioskDevice) {
    setError("");
    setSuccess("");
    setNewPin("");
    setBusy(true);
    try {
      const response = await fetch(`/api/kiosk/devices/${device.id}/pin`, {
        cache: "no-store",
      });
      const result = await responseJson(response);
      setNewPin(result.pin);
      setNewPinDevice(`${device.label} · ${device.outletCode}`);
      setSuccess(`Showing the saved PIN for ${device.label}.`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to show kiosk PIN.",
      );
    } finally {
      setBusy(false);
    }
  }

  function startEditing(device: KioskDevice) {
    setEditingDeviceId(device.id);
    setEditingLabel(device.label);
    setError("");
    setSuccess("");
  }

  async function saveDeviceName(
    event: FormEvent<HTMLFormElement>,
    device: KioskDevice,
  ) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      const response = await fetch(`/api/kiosk/devices/${device.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: editingLabel }),
      });
      await responseJson(response);
      setEditingDeviceId("");
      setSuccess(`Device name updated to ${editingLabel.trim()}.`);
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to update device name.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function rotatePin(device: KioskDevice) {
    if (
      !window.confirm(
        `${device.hasPin ? "Reset" : "Set up"} the PIN for ${device.label}? Its current kiosk access will be disconnected.`,
      )
    )
      return;
    setError("");
    setSuccess("");
    setNewPin("");
    setBusy(true);
    try {
      const response = await fetch(`/api/kiosk/devices/${device.id}/pin`, {
        method: "POST",
      });
      const result = await responseJson(response);
      setNewPin(result.pin);
      setNewPinDevice(`${device.label} · ${device.outletCode}`);
      setSuccess(
        `A new PIN was set for ${device.label}. Its previous kiosk token and PIN no longer work.`,
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to set kiosk PIN.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyPin() {
    try {
      await navigator.clipboard.writeText(newPin);
      setSuccess("Kiosk PIN copied. Share it only with the assigned outlet.");
    } catch {
      setError("Copy was blocked. Select and copy the PIN manually.");
    }
  }

  return (
    <main className="content-area kiosk-management">
      <header className="page-head">
        <div>
          <p className="eyebrow">ATTENDANCE SETUP</p>
          <h1>Attendance kiosks</h1>
          <p>Create outlet kiosks with a PIN, and manage or delete registered devices.</p>
          <a className="button button-secondary" href="/kiosk">
            Open employee attendance kiosk
          </a>
        </div>
      </header>
      {error && <p className="form-error" role="alert">{error}</p>}
      {success && <p className="form-success" role="status">{success}</p>}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Register a kiosk device</h2>
            <p>
              The 8-digit PIN is stored encrypted and can be shown again by an
              administrator. Enter it once on the assigned kiosk; the browser
              remembers its secure session for one year.
            </p>
          </div>
        </div>
        <form className="form-grid" onSubmit={(event) => void createDevice(event)}>
          <label className="field">
            <span>Outlet</span>
            <RoundedSelect
              value={outletId}
              onChange={(event) => setOutletId(event.target.value)}
              required
            >
              {outlets.map((outlet) => (
                <option key={outlet.id} value={outlet.id}>
                  {outlet.code} · {outlet.name}
                </option>
              ))}
            </RoundedSelect>
          </label>
          <label className="field">
            <span>Device name</span>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              minLength={2}
              maxLength={80}
              placeholder="e.g. Front counter tablet"
              required
            />
          </label>
          <div className="form-actions">
            <button
              className="button button-primary"
              disabled={busy || !outlets.length}
            >
              {busy ? "Creating…" : "Create kiosk"}
            </button>
          </div>
        </form>
        {newPin && (
          <div className="kiosk-token-result">
            <strong>
              PIN for {newPinDevice}
            </strong>
            <code>{newPin}</code>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void copyPin()}
            >
              Copy PIN
            </button>
            <p>
              Open <code>/kiosk</code> on that device and enter this PIN once.
              You can show it again from the device list. The browser stays
              connected until disconnected, deleted, or the session expires.
            </p>
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Registered devices</h2>
            <p>PINs can be shown or reset. Delete removes a device immediately.</p>
          </div>
        </div>
        {devices.length ? (
          <div className="kiosk-device-list">
            {devices.map((device) => (
              <article className="kiosk-device-row" key={device.id}>
                <div>
                  {editingDeviceId === device.id ? (
                    <form
                      className="kiosk-device-name-form"
                      onSubmit={(event) => void saveDeviceName(event, device)}
                    >
                      <input
                        value={editingLabel}
                        onChange={(event) => setEditingLabel(event.target.value)}
                        minLength={2}
                        maxLength={80}
                        aria-label={`Device name for ${device.label}`}
                        required
                      />
                      <button
                        className="button button-primary"
                        type="submit"
                        disabled={busy}
                      >
                        Save
                      </button>
                      <button
                        className="button button-secondary"
                        type="button"
                        onClick={() => setEditingDeviceId("")}
                        disabled={busy}
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      <strong>{device.label}</strong>
                      <button
                        className="button button-secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => startEditing(device)}
                      >
                        Edit name
                      </button>
                    </>
                  )}
                  <span>{device.outletCode} · {device.outletName}</span>
                  <small>
                    {device.lastUsedAt
                      ? `Last used ${new Date(device.lastUsedAt).toLocaleString()}`
                      : `Created ${new Date(device.createdAt).toLocaleDateString()}`}
                  </small>
                  {device.hasPin && !device.canShowPin && (
                    <small>
                      This older PIN cannot be recovered. Reset it to create a
                      new PIN that can be shown.
                    </small>
                  )}
                </div>
                <div className="kiosk-device-actions">
                  <span className={`badge ${device.active ? "badge-green" : "badge-amber"}`}>
                    {device.active ? "Active" : "Revoked"}
                  </span>
                  {device.active && (
                    <>
                      {device.canShowPin && (
                        <button
                          className="button button-secondary"
                          type="button"
                          disabled={busy}
                          onClick={() => void showPin(device)}
                        >
                          Show PIN
                        </button>
                      )}
                      <button
                        className="button button-secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => void rotatePin(device)}
                      >
                        {device.hasPin ? "Reset PIN" : "Set up PIN"}
                      </button>
                    </>
                  )}
                  <button
                    className="button button-danger"
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteDevice(device)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">No kiosk devices have been registered.</p>
        )}
      </section>
    </main>
  );
}
