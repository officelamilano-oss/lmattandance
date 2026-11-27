"use client";

import { useEffect, useRef, useState } from "react";
import { getFaceDescriptor, startFaceCamera, stopFaceCamera } from "@/components/face-client";

type FaceEnrollmentStatus = {
  enrolled: boolean;
  consentAt: string | null;
};

async function responseJson(response: Response) {
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? "Unable to update face enrollment.");
  return body;
}

export function EmployeeFaceEnrollment({
  employeeId,
}: {
  employeeId: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<FaceEnrollmentStatus>({
    enrolled: false,
    consentAt: null,
  });
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    void fetch(`/api/employees/${employeeId}/face`, { cache: "no-store" })
      .then(responseJson)
      .then((result: FaceEnrollmentStatus) => {
        if (active) setStatus(result);
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load face enrollment status.",
          );
      });
    return () => {
      active = false;
      stopFaceCamera(streamRef.current);
    };
  }, [employeeId]);

  async function openCamera() {
    setError("");
    setSuccess("");
    try {
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview is unavailable.");
      streamRef.current = await startFaceCamera(video);
      setCameraReady(true);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to open the camera.",
      );
    }
  }

  async function enroll() {
    setError("");
    setSuccess("");
    if (!consentConfirmed) {
      setError("Confirm the employee's consent before enrolling.");
      return;
    }
    const video = videoRef.current;
    if (!video || !cameraReady) {
      setError("Start the camera before capturing a face template.");
      return;
    }
    setBusy(true);
    try {
      const descriptor = await getFaceDescriptor(video, false);
      const response = await fetch(`/api/employees/${employeeId}/face`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descriptor, consentConfirmed: true }),
      });
      const result = await responseJson(response);
      setStatus({ enrolled: true, consentAt: result.consentAt });
      setConsentConfirmed(false);
      setSuccess("Face template enrolled. No camera image was stored.");
      stopFaceCamera(streamRef.current);
      streamRef.current = null;
      setCameraReady(false);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to enroll face.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeEnrollment() {
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      const response = await fetch(`/api/employees/${employeeId}/face`, {
        method: "DELETE",
      });
      await responseJson(response);
      setStatus({ enrolled: false, consentAt: null });
      setSuccess("Face template and consent record were removed.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to remove face enrollment.",
      );
    } finally {
      setBusy(false);
    }
  }

  function closeCamera() {
    stopFaceCamera(streamRef.current);
    streamRef.current = null;
    setCameraReady(false);
  }

  return (
    <section className="panel employee-face-enrollment">
      <div className="panel-heading">
        <div>
          <h2>Face attendance enrollment</h2>
          <p>
            Camera frames stay in this browser. Only an encrypted face
            descriptor is stored; no photo or video is saved.
          </p>
        </div>
        <span className={`badge ${status.enrolled ? "badge-green" : "badge-amber"}`}>
          {status.enrolled ? "Enrolled" : "Not enrolled"}
        </span>
      </div>
      {status.consentAt && (
        <p className="muted employee-face-consent-date">
          Consent recorded {new Date(status.consentAt).toLocaleString()}.
        </p>
      )}
      {error && <p className="form-error employee-face-notice" role="alert">{error}</p>}
      {success && <p className="form-success employee-face-notice" role="status">{success}</p>}
      <label className="employee-face-consent">
        <input
          type="checkbox"
          checked={consentConfirmed}
          onChange={(event) => setConsentConfirmed(event.target.checked)}
          disabled={busy}
        />
        <span>
          I confirm the employee was informed and gave explicit consent to
          face-based attendance, and understands they can request deletion.
        </span>
      </label>
      <div className="employee-face-camera">
        <video ref={videoRef} autoPlay playsInline muted hidden={!cameraReady} />
        {!cameraReady ? (
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void openCamera()}
            disabled={busy}
          >
            Open camera
          </button>
        ) : (
          <>
            <button
              className="button button-primary"
              type="button"
              onClick={() => void enroll()}
              disabled={busy || !consentConfirmed}
            >
              {busy ? "Capturing…" : "Capture and enroll face"}
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={closeCamera}
              disabled={busy}
            >
              Close camera
            </button>
          </>
        )}
        {status.enrolled && (
          <button
            className="button button-danger"
            type="button"
            onClick={() => void removeEnrollment()}
            disabled={busy}
          >
            Delete face enrollment
          </button>
        )}
      </div>
      <small className="muted employee-face-disclaimer">
        Face matching is a convenience check, not strong anti-spoof protection.
        Keep the kiosk supervised and provide a non-biometric attendance option.
      </small>
    </section>
  );
}
