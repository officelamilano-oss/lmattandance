import "../../globals.css";
import { Suspense } from "react";
import { FaceAttendanceLogReport } from "@/components/face-attendance-log-report";
import { requireActor } from "@/lib/permissions";

export default async function FaceAttendanceLogPage() {
  return (
    <Suspense fallback={<div className="content-area">Loading report…</div>}>
      <AuthorizedFaceAttendanceLogPage />
    </Suspense>
  );
}

async function AuthorizedFaceAttendanceLogPage() {
  const actor = await requireActor("employees.read");
  return (
    <FaceAttendanceLogReport
      canEditClockOut={
        actor.role === "MAIN_ADMIN" ||
        (actor.role === "CO_ADMIN" &&
          actor.permissions.includes("employees.update"))
      }
    />
  );
}
