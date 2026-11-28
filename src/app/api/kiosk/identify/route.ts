import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, readJson } from "@/lib/http";
import { getDb } from "@/lib/mongodb";
import {
  getFaceEncryptionKey,
  isFaceDescriptor,
} from "@/lib/face-templates";
import { matchEmployeeFace } from "@/lib/match-employee-face";
import { getKioskAttendanceState } from "@/lib/kiosk-attendance-state";
import { getFaceLogAction } from "@/lib/face-attendance-logs";
import { assertOutletAccess, getActor, hasPermission } from "@/lib/permissions";

const identifySchema = z.object({
  outletId: z.string().regex(/^[a-f\d]{24}$/i),
  employeeId: z.string().regex(/^[a-f\d]{24}$/i),
  descriptor: z.custom<number[]>(isFaceDescriptor),
});

export async function POST(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Sign in to your workspace to use the attendance kiosk." },
        { status: 401 },
      );
    if (!hasPermission(actor, "attendance.write"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    if (!process.env.KIOSK_ENCRYPTION_KEY)
      return NextResponse.json(
        { error: "Face matching is unavailable until KIOSK_ENCRYPTION_KEY is configured." },
        { status: 503 },
      );
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 16_384)
      return NextResponse.json(
        { error: "Face descriptor request is too large." },
        { status: 413 },
      );
    const input = identifySchema.parse(await readJson<unknown>(request));
    const outletId = new ObjectId(input.outletId);
    assertOutletAccess(actor, outletId);
    getFaceEncryptionKey();
    const db = await getDb();
    const employee = await matchEmployeeFace(
      db,
      outletId,
      input.descriptor,
    );
    if (!employee)
      return NextResponse.json(
        { error: "Face not recognized. Please try again or contact your manager." },
        { status: 404 },
      );
    if (!employee._id.equals(input.employeeId))
      return NextResponse.json(
        { error: "The detected face does not match the selected employee." },
        { status: 409 },
      );
    const now = new Date();
    const faceLogAction = await getFaceLogAction(
      db,
      employee,
      outletId,
      now,
    );
    const state =
      !employee.shiftStartTime || !employee.shiftEndTime
        ? { action: faceLogAction }
        : await getKioskAttendanceState(
            db,
            employee,
            outletId,
            now,
          );
    const attendanceActionAllowed =
      state.action === "CHECK_IN" || state.action === "CHECK_OUT";
    const nextAction = attendanceActionAllowed ? state.action : faceLogAction;
    return NextResponse.json({
      employee: {
        id: employee._id.toHexString(),
        name: employee.fullName,
        code: employee.employeeCode,
      },
      nextAction,
      ...("message" in state && state.message
        ? { message: `${state.message} Face punch can still be saved to the log.` }
        : {}),
    });
  } catch (error) {
    return apiError(error);
  }
}
