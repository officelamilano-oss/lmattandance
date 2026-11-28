"use client";

import {
  ChevronDown,
  Search,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AutoDismissNotice } from "@/components/auto-dismiss-notice";
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

type KioskOutlet = { id: string; code: string; name: string };
type KioskEmployee = {
  id: string;
  code: string;
  name: string;
  outletId: string;
  outletCode: string;
  outletName: string;
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
  const outletPickerRef = useRef<HTMLDetailsElement>(null);
  const scanOpenerRef = useRef<HTMLElement | null>(null);
  const cameraDialogRef = useRef<HTMLElement>(null);
  const [authorized, setAuthorized] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [outlets, setOutlets] = useState<KioskOutlet[]>([]);
  const [selectedOutletId, setSelectedOutletId] = useState("all");
  const [employees, setEmployees] = useState<KioskEmployee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [selectedEmployee, setSelectedEmployee] =
    useState<KioskEmployee | null>(null);
  const [recognizedEmployee, setRecognizedEmployee] =
    useState<Identification["employee"] | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [autoStartCamera, setAutoStartCamera] = useState(false);
  const [cameraStartRequest, setCameraStartRequest] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [message, setMessage] = useState("Choose an employee to start.");
  const visibleEmployees = useMemo(
    () =>
      employees.filter((employee) =>
        `${employee.code} ${employee.name} ${employee.outletCode} ${employee.outletName}`
          .toLowerCase()
          .includes(employeeSearch.trim().toLowerCase()),
      ),
    [employeeSearch, employees],
  );
  const selectedOutlet = outlets.find(
    (outlet) => outlet.id === selectedOutletId,
  );

  useEffect(() => {
    let active = true;
    void fetch("/api/kiosk/session", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403)
          throw new KioskRequestError(
            "Sign in to the workspace with attendance access to use the kiosk.",
            response.status,
          );
        return (await responseJson(response)) as { outlets: KioskOutlet[] };
      })
      .then((result) => {
        if (!active) return;
        setOutlets(result.outlets);
        setAuthorized(true);
        setMessage("Choose an outlet and employee to start the face scan.");
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

  useEffect(() => {
    if (!authorized) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setEmployeesLoading(true);
      setEmployees([]);
    });
    const query = selectedOutletId === "all"
      ? "all"
      : encodeURIComponent(selectedOutletId);
    void fetch(`/api/kiosk/session?outletId=${query}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await responseJson(response);
        return result as { employees: KioskEmployee[] };
      })
      .then((result) => {
        if (active) setEmployees(result.employees);
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load enrolled employees.",
          );
      })
      .finally(() => {
        if (active) setEmployeesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authorized, selectedOutletId]);

  const stopScan = useCallback(() => {
    stopFaceCamera(streamRef.current);
    streamRef.current = null;
    setCameraReady(false);
    setCameraStarting(false);
    setAutoStartCamera(false);
    setRecognizedEmployee(null);
    setSelectedEmployee(null);
    setMessage("Choose another employee to start.");
    window.requestAnimationFrame(() => scanOpenerRef.current?.focus());
  }, []);

  function selectOutlet(outletId: string) {
    stopFaceCamera(streamRef.current);
    streamRef.current = null;
    setCameraReady(false);
    setAutoStartCamera(false);
    setSelectedEmployee(null);
    setRecognizedEmployee(null);
    setSelectedOutletId(outletId);
    setEmployees([]);
    setEmployeesLoading(true);
    setError("");
  }

  function selectEmployee(employee: KioskEmployee, opener: HTMLElement) {
    stopFaceCamera(streamRef.current);
    streamRef.current = null;
    setCameraReady(false);
    setCameraStarting(false);
    scanOpenerRef.current = opener;
    setError("");
    setSuccess("");
    setSelectedEmployee(employee);
    setRecognizedEmployee(null);
    setMessage(`Opening camera for ${employee.name}…`);
    setAutoStartCamera(true);
    setCameraStartRequest((request) => request + 1);
  }

  useEffect(() => {
    if (!selectedEmployee) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        stopScan();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = cameraDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], video[tabindex], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedEmployee, stopScan]);

  useEffect(() => {
    if (!authorized || !selectedEmployee || cameraReady || !autoStartCamera)
      return;
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
        setMessage(`Camera is ready for ${selectedEmployee.name}.`);
      } catch (caught) {
        if (active) {
          setAutoStartCamera(false);
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to open the camera.",
          );
        }
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
    selectedEmployee,
  ]);

  useEffect(() => {
    if (!authorized || !cameraReady || !selectedEmployee) return;
    let active = true;

    async function identify(descriptor: number[]) {
      const response = await fetch("/api/kiosk/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descriptor,
          outletId: selectedEmployee!.outletId,
          employeeId: selectedEmployee!.id,
        }),
      });
      return (await responseJson(response)) as Identification;
    }

    async function punch(descriptor: number[]) {
      const response = await fetch("/api/kiosk/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descriptor,
          outletId: selectedEmployee!.outletId,
          employeeId: selectedEmployee!.id,
        }),
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
          if (
            result.nextAction === "CHECK_IN" ||
            result.nextAction === "CHECK_OUT"
          ) {
            setMessage(
              `${result.employee.name} is recognized. Recording attendance…`,
            );
            const punchResult = await punch(descriptor);
            if (!active) break;
            const punchedAt = new Date(punchResult.punchedAt).toLocaleTimeString();
            stopFaceCamera(streamRef.current);
            streamRef.current = null;
            setCameraReady(false);
            setAutoStartCamera(false);
            setSuccess(
              punchResult.action === "IN"
                ? punchResult.attendanceMarked === false
                  ? `${punchResult.employee.name}, your face clock-in was recorded at ${punchedAt}.`
                  : `${punchResult.employee.name}, your shift has started. Attendance marked present at ${punchedAt}.`
                : punchResult.attendanceMarked === false
                  ? `${punchResult.employee.name}, your face clock-out was recorded at ${punchedAt}.`
                  : `${punchResult.employee.name}, your shift has ended. Check-out recorded at ${punchedAt}.`,
            );
            setSelectedEmployee(null);
            setRecognizedEmployee(null);
            setMessage("Camera is off. Select another employee when ready.");
            return;
          }

          setMessage(
            `${result.employee.name} (${result.employee.code}). ${result.message ?? "Face recognized."}`,
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
            setError("Your workspace session expired. Sign in again to continue.");
            break;
          }
          if (caught instanceof KioskRequestError && caught.status === 409) {
            if (
              caught.message !==
              "The detected face does not match the selected employee."
            ) {
              stopFaceCamera(streamRef.current);
              streamRef.current = null;
              setCameraReady(false);
              setAutoStartCamera(false);
            }
            setMessage(caught.message);
            if (cameraReady) {
              await wait(1000);
              continue;
            }
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
  }, [authorized, cameraReady, selectedEmployee]);

  return (
    <>
    <main className="kiosk-page content-area kiosk-terminal">
      <header className="page-head kiosk-content">
        <div>
          <p className="eyebrow">LA MILANO · ATTENDANCE</p>
          <h1>Face attendance kiosk</h1>
          <p>
            Select an outlet and employee. The camera opens for that employee
            and turns off after the face punch.
          </p>
        </div>
      </header>
      {sessionLoading ? (
        <section
          className="panel kiosk-employee-panel kiosk-content kiosk-initial-loading"
          role="status"
          aria-label="Loading kiosk options"
          aria-busy="true"
        >
          <span className="kiosk-sr-only">Loading kiosk options</span>
          <div className="panel-heading" aria-hidden="true">
            <div>
              <h2>Select employee</h2>
              <p>Only active employees with registered faces are listed.</p>
            </div>
          </div>
          <div className="kiosk-selector-row" aria-hidden="true">
            <div className="kiosk-skeleton kiosk-skeleton-control" />
            <div className="kiosk-skeleton kiosk-skeleton-control" />
          </div>
          <div className="kiosk-initial-employee-skeletons" aria-hidden="true">
            <div className="kiosk-skeleton kiosk-skeleton-employee" />
            <div className="kiosk-skeleton kiosk-skeleton-employee" />
          </div>
        </section>
      ) : !authorized ? (
        <section className="panel kiosk-token-panel kiosk-content">
          <h2>Workspace sign-in required</h2>
          <p>
            Sign in with an account that has attendance access to use the face
            attendance kiosk.
          </p>
          <Link className="button button-primary" href="/login">
            Sign in to workspace
          </Link>
          {error && <p className="form-error" role="alert">{error}</p>}
        </section>
      ) : (
        <>
          <section className="panel kiosk-employee-panel kiosk-content">
            <div className="panel-heading">
              <div>
                <h2>Select employee</h2>
                <p>Only active employees with registered faces are listed.</p>
              </div>
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="kiosk-selector-row">
              <label className="field">
                <span>Location</span>
                <details
                  className="kiosk-outlet-picker"
                  ref={outletPickerRef}
                  onBlur={(event) => {
                    if (
                      !(event.relatedTarget instanceof Node) ||
                      !event.currentTarget.contains(event.relatedTarget)
                    )
                      event.currentTarget.open = false;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.currentTarget.open = false;
                      event.currentTarget.querySelector("summary")?.focus();
                    }
                  }}
                >
                  <summary aria-label="Choose location">
                    <span>
                      {selectedOutletId === "all"
                        ? "All Outlets"
                        : selectedOutlet
                          ? `${selectedOutlet.code} · ${selectedOutlet.name}`
                          : "Choose location"}
                    </span>
                    <ChevronDown size={17} aria-hidden="true" />
                  </summary>
                  <div
                    className="kiosk-outlet-options"
                    role="group"
                    aria-label="Locations"
                  >
                    <button
                      type="button"
                      className={
                        selectedOutletId === "all"
                          ? "kiosk-outlet-option is-selected"
                          : "kiosk-outlet-option"
                      }
                      aria-pressed={selectedOutletId === "all"}
                      onClick={() => {
                        selectOutlet("all");
                        outletPickerRef.current?.querySelector("summary")?.focus();
                        outletPickerRef.current?.removeAttribute("open");
                      }}
                    >
                      All Outlets
                    </button>
                    {outlets.map((outlet) => (
                      <button
                        key={outlet.id}
                        type="button"
                        className={
                          selectedOutletId === outlet.id
                            ? "kiosk-outlet-option is-selected"
                            : "kiosk-outlet-option"
                        }
                        aria-pressed={selectedOutletId === outlet.id}
                        onClick={() => {
                          selectOutlet(outlet.id);
                          outletPickerRef.current
                            ?.querySelector("summary")
                            ?.focus();
                          outletPickerRef.current?.removeAttribute("open");
                        }}
                      >
                        <span>{outlet.code}</span>
                        <span>{outlet.name}</span>
                      </button>
                    ))}
                  </div>
                </details>
              </label>
              <label className="kiosk-employee-search">
                <Search size={16} aria-hidden="true" />
                <input
                  value={employeeSearch}
                  onChange={(event) => setEmployeeSearch(event.target.value)}
                  aria-label="Search employees"
                  placeholder="Search employee"
                />
              </label>
            </div>
            {employeesLoading ? (
              <div className="kiosk-loading-state" role="status">
                <span className="kiosk-loading-spinner" aria-hidden="true" />
                <span>Loading enrolled employees…</span>
              </div>
            ) : visibleEmployees.length ? (
              <div className="kiosk-employee-list">
                {visibleEmployees.map((employee) => (
                  <button
                    className="kiosk-employee-option"
                    key={employee.id}
                    type="button"
                    onClick={(event) =>
                      selectEmployee(employee, event.currentTarget)
                    }
                  >
                    <Users size={17} aria-hidden="true" />
                    <span>
                      <strong>{employee.code} · {employee.name}</strong>
                      {selectedOutletId === "all" && (
                        <small>{employee.outletCode} · {employee.outletName}</small>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="kiosk-no-employees">
                No enrolled employees available for this outlet.
              </p>
            )}
          </section>
        </>
      )}
      {success && (
        <AutoDismissNotice message={success} variant="success" />
      )}
    </main>
    {selectedEmployee &&
      createPortal(
        <div
          className="kiosk-camera-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) stopScan();
          }}
        >
          <section
            className="panel kiosk-camera-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kiosk-camera-title"
            ref={cameraDialogRef}
          >
            <div className="panel-heading kiosk-camera-modal-heading">
              <div>
                <h2 id="kiosk-camera-title">
                  {selectedEmployee.name} · {selectedEmployee.code}
                </h2>
                <p>
                  {selectedEmployee.outletCode} · {selectedEmployee.outletName}
                </p>
              </div>
              <button
                className="button button-secondary"
                type="button"
                autoFocus
                onClick={stopScan}
              >
                Cancel scan
              </button>
            </div>
            {error && <p className="form-error kiosk-camera-modal-error" role="alert">{error}</p>}
            <div className="kiosk-camera kiosk-camera-modal-preview">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                hidden={!cameraReady}
              />
              {!cameraReady && !cameraStarting && (
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => {
                    setError("");
                    setAutoStartCamera(true);
                    setCameraStartRequest((request) => request + 1);
                  }}
                >
                  Try camera again
                </button>
              )}
              {cameraStarting && <span role="status">Opening camera…</span>}
            </div>
            <div className="kiosk-identification" aria-live="polite">
              {recognizedEmployee && (
                <p>
                  Face recognized:{" "}
                  <strong>{recognizedEmployee.name} ({recognizedEmployee.code})</strong>
                </p>
              )}
              <p>{message}</p>
            </div>
            <small className="muted kiosk-camera-modal-note">
              Your camera turns off after the face punch.
            </small>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
