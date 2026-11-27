"use client";

import { Activity, ArrowLeft, Menu, Moon, Sun, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  FaceScanError,
  getFaceDescriptor,
  startFaceCamera,
  stopFaceCamera,
} from "@/components/face-client";

type KioskAction =
  | "CHECK_IN"
  | "CHECK_OUT"
  | "WAIT_FOR_SHIFT"
  | "WAIT_FOR_CHECKOUT"
  | "DONE"
  | "ABSENT"
  | "CONTACT_MANAGER";

type Identification = {
  employee: { id: string; name: string; code: string };
  nextAction: KioskAction;
  message?: string;
};

type KioskContext = {
  device: { label: string };
  outlet: { code: string; name: string };
};

class KioskRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function responseJson(response: Response) {
  const body = await response.json();
  if (!response.ok)
    throw new KioskRequestError(
      body.error ?? "Kiosk request could not be completed.",
      response.status,
    );
  return body;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

export function KioskTerminal() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [pinInput, setPinInput] = useState("");
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [kioskContext, setKioskContext] = useState<KioskContext | null>(null);
  const [recognizedEmployee, setRecognizedEmployee] =
    useState<Identification["employee"] | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [autoStartCamera, setAutoStartCamera] = useState(true);
  const [cameraStartRequest, setCameraStartRequest] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [hasCompletedPunch, setHasCompletedPunch] = useState(false);
  const [message, setMessage] = useState(
    "Enter the kiosk PIN to connect this device.",
  );

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(""), 2000);
    return () => window.clearTimeout(timer);
  }, [success]);

  useEffect(() => {
    window.localStorage.removeItem("attendance-kiosk-token");
    let active = true;
    void fetch("/api/kiosk/session", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) return null;
        return (await responseJson(response)) as KioskContext;
      })
      .then((result) => {
        if (!active) return;
        if (result) {
          setKioskContext(result);
          setAuthorized(true);
          setMessage(
            `Connected to ${result.outlet.code} · ${result.outlet.name}. Starting camera…`,
          );
        }
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to check saved kiosk setup.",
          );
      })
      .finally(() => {
        if (active) setSessionLoading(false);
      });
    return () => {
      active = false;
      stopFaceCamera(streamRef.current);
    };
  }, []);

  async function savePin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setPinSubmitting(true);
    try {
      const response = await fetch("/api/kiosk/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinInput.trim() }),
      });
      const result = (await responseJson(response)) as KioskContext;
      setKioskContext(result);
      setAuthorized(true);
      setPinInput("");
      setAutoStartCamera(true);
      setMessage(
        `Connected to ${result.outlet.code} · ${result.outlet.name}. Starting camera…`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to connect kiosk.",
      );
    } finally {
      setPinSubmitting(false);
    }
  }

  async function disconnect() {
    stopFaceCamera(streamRef.current);
    streamRef.current = null;
    setCameraReady(false);
    setAutoStartCamera(false);
    try {
      const response = await fetch("/api/kiosk/session", { method: "DELETE" });
      await responseJson(response);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to disconnect this kiosk.",
      );
    }
    setAuthorized(false);
    setKioskContext(null);
    setRecognizedEmployee(null);
    setSuccess("");
    setHasCompletedPunch(false);
    setMessage("Kiosk disconnected. Enter its PIN to connect again.");
  }

  async function openCamera() {
    setError("");
    setSuccess("");
    setAutoStartCamera(true);
    setCameraStartRequest((request) => request + 1);
  }

  function toggleTheme() {
    const nextDarkMode = !darkMode;
    setDarkMode(nextDarkMode);
    document.documentElement.dataset.theme = nextDarkMode ? "dark" : "light";
  }

  useEffect(() => {
    if (!authorized || cameraReady || !autoStartCamera) return;
    let active = true;
    queueMicrotask(() => {
      if (active) setCameraStarting(true);
    });
    void (async () => {
      try {
        if (!videoRef.current)
          throw new Error("Camera preview is unavailable.");
        const stream = await startFaceCamera(videoRef.current);
        if (!active) {
          stopFaceCamera(stream);
          return;
        }
        streamRef.current = stream;
        setCameraReady(true);
        setError("");
        setMessage(
          `Camera is on at ${kioskContext?.outlet.code ?? "this outlet"}. Show an enrolled face to check attendance.`,
        );
      } catch (caught) {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to open the camera.",
          );
      } finally {
        if (active) setCameraStarting(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [
    authorized,
    autoStartCamera,
    cameraReady,
    cameraStartRequest,
    kioskContext,
  ]);

  useEffect(() => {
    if (!authorized || !cameraReady) return;
    let active = true;

    async function identify(descriptor: number[]) {
      const response = await fetch("/api/kiosk/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descriptor }),
      });
      return (await responseJson(response)) as Identification;
    }

    async function punch(descriptor: number[]) {
      const response = await fetch("/api/kiosk/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descriptor }),
      });
      return responseJson(response);
    }

    async function scanContinuously() {
      while (active) {
        try {
          const video = videoRef.current;
          if (!video) throw new Error("Camera preview is unavailable.");
          const descriptor = await getFaceDescriptor(video, false);
          if (!active) break;
          const result = await identify(descriptor);
          if (!active) break;

          setRecognizedEmployee(result.employee);
          setError("");
          setSuccess("");
          const outletLabel = kioskContext
            ? `${kioskContext.outlet.code} · ${kioskContext.outlet.name}`
            : "this outlet";
          if (
            result.nextAction === "CHECK_IN" ||
            result.nextAction === "CHECK_OUT"
          ) {
            setMessage(
              `${result.employee.name} is recognized at ${outletLabel}. Recording attendance…`,
            );
            const punchResult = await punch(descriptor);
            if (!active) break;
            const punchedAt = new Date(punchResult.punchedAt).toLocaleTimeString();
            stopFaceCamera(streamRef.current);
            streamRef.current = null;
            setCameraReady(false);
            setAutoStartCamera(false);
            setHasCompletedPunch(true);
            setSuccess(
              punchResult.action === "IN"
                ? `${punchResult.employee.name}, your shift has started. Attendance marked present at ${punchedAt}.`
                : `${punchResult.employee.name}, your shift has ended. Check-out recorded at ${punchedAt}.`,
            );
            setMessage("Camera is off. Start scanning when the next employee is ready.");
            return;
          }

          setMessage(
            `${result.employee.name} (${result.employee.code}) · ${outletLabel}. ${result.message ?? "No attendance action is due right now."}`,
          );
          await wait(result.nextAction === "DONE" ? 8000 : 3000);
        } catch (caught) {
          if (!active) break;
          if (
            caught instanceof FaceScanError ||
            (caught instanceof KioskRequestError && caught.status === 404)
          ) {
            setRecognizedEmployee(null);
            setError("");
            setMessage(
              caught instanceof FaceScanError
                ? "Camera is ready. Stand in view to scan an enrolled face."
                : "Face not recognized. Ask a manager to confirm face enrollment.",
            );
            await wait(1000);
            continue;
          }
          if (caught instanceof KioskRequestError && caught.status === 401) {
            stopFaceCamera(streamRef.current);
            streamRef.current = null;
            setCameraReady(false);
            setAuthorized(false);
            setKioskContext(null);
            setError("This kiosk PIN was reset or the device was revoked. Ask an administrator for the current PIN.");
            break;
          }
          if (caught instanceof KioskRequestError && caught.status === 409) {
            stopFaceCamera(streamRef.current);
            streamRef.current = null;
            setCameraReady(false);
            setAutoStartCamera(false);
            setMessage(caught.message);
            break;
          }
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to process face attendance.",
          );
          await wait(3000);
        }
      }
    }

    void scanContinuously();
    return () => {
      active = false;
    };
  }, [authorized, cameraReady, kioskContext]);

  return (
    <main className="kiosk-page content-area kiosk-terminal">
      <header className="topbar kiosk-app-topbar">
        <button
          className="icon-button kiosk-menu-button"
          type="button"
          aria-label={navigationOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={navigationOpen}
          onClick={() => setNavigationOpen((open) => !open)}
        >
          {navigationOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <div className="breadcrumb">
          <Activity size={16} aria-hidden="true" />
          <span>Operations</span>
          <b>/</b>
          <strong>Attendance kiosk</strong>
        </div>
        <div className="topbar-right kiosk-topbar-right">
          <button
            className="topbar-utility"
            type="button"
            aria-label={darkMode ? "Switch to light theme" : "Switch to dark theme"}
            title={darkMode ? "Switch to light theme" : "Switch to dark theme"}
            onClick={toggleTheme}
          >
            {darkMode ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <Link className="button button-secondary kiosk-workspace-button" href="/">
            <ArrowLeft aria-hidden="true" size={17} />
            <span>Back to workspace</span>
          </Link>
        </div>
        {navigationOpen && (
          <nav className="kiosk-menu" aria-label="Workspace navigation">
            <Link href="/attendance" onClick={() => setNavigationOpen(false)}>Attendance</Link>
            <Link href="/employees" onClick={() => setNavigationOpen(false)}>Employees</Link>
            <Link href="/" onClick={() => setNavigationOpen(false)}>Back to workspace</Link>
          </nav>
        )}
      </header>
      {kioskContext && (
        <p className="kiosk-nav-context">
          {kioskContext.outlet.code} · {kioskContext.outlet.name} · {kioskContext.device.label}
        </p>
      )}
      <header className="page-head kiosk-content">
        <div>
          <p className="eyebrow">LA MILANO · ATTENDANCE</p>
          <h1>Automatic face attendance</h1>
          <p>
            Show your enrolled face at shift start for check-in and again after
            shift end for check-out.
          </p>
        </div>
      </header>
      {sessionLoading ? (
        <section className="panel kiosk-token-panel kiosk-content" role="status">
          Checking this browser’s saved kiosk setup…
        </section>
      ) : !authorized ? (
        <section className="panel kiosk-token-panel kiosk-content">
          <h2>Connect this outlet kiosk</h2>
          <p>
            Enter the 8-digit PIN once. This browser securely remembers the
            kiosk for one year, so the PIN will not be requested every time.
          </p>
          <form className="form-grid" onSubmit={(event) => void savePin(event)}>
            <label className="field">
              <span>Kiosk PIN</span>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                value={pinInput}
                onChange={(event) =>
                  setPinInput(event.target.value.replace(/\D/g, "").slice(0, 8))
                }
                required
              />
            </label>
            <div className="form-actions">
              <button
                className="button button-primary"
                disabled={pinSubmitting || pinInput.length !== 8}
              >
                {pinSubmitting ? "Connecting…" : "Connect kiosk"}
              </button>
            </div>
          </form>
          {error && <p className="form-error" role="alert">{error}</p>}
        </section>
      ) : (
        <section className="panel kiosk-camera-panel kiosk-content">
          <div className="panel-heading">
            <div>
              <h2>Automatic shift check-in and check-out</h2>
              <p>
                Check-out is accepted only at or after the employee’s scheduled
                shift end.
              </p>
            </div>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void disconnect()}
            >
              Disconnect kiosk
            </button>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="kiosk-camera">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              hidden={!cameraReady}
            />
            {!cameraReady && (
              <button
                className="button button-primary"
                type="button"
                onClick={() => void openCamera()}
                disabled={cameraStarting}
              >
                {cameraStarting
                  ? "Starting camera…"
                  : hasCompletedPunch
                    ? "Check in another employee"
                    : "Start camera"}
              </button>
            )}
          </div>
          <div className="kiosk-identification" aria-live="polite">
            {kioskContext && (
              <p>
                Outlet: <strong>{kioskContext.outlet.code} · {kioskContext.outlet.name}</strong>
                {" · "}Device: <strong>{kioskContext.device.label}</strong>
              </p>
            )}
            {recognizedEmployee && (
              <p>
                Recognized employee:{" "}
                <strong>
                  {recognizedEmployee.name} ({recognizedEmployee.code})
                </strong>
              </p>
          )}
          <p>{message}</p>
          </div>
          <small className="muted">
            The camera turns off after each successful attendance. Start it
            again for the next employee. At shift start, check-in is marked
            only when the configured shift window opens.
          </small>
        </section>
      )}
      {success && (
        <div className="kiosk-toast" role="status" aria-live="polite" aria-atomic="true">
          {success}
        </div>
      )}
    </main>
  );
}
