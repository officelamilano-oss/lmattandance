import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/http";
import { getDb } from "@/lib/mongodb";
import {
  getFaceEncryptionKey,
  isFaceDescriptor,
} from "@/lib/face-templates";
import { authorizeKioskDevice } from "@/lib/kiosk-auth";
import { matchEmployeeFace } from "@/lib/match-employee-face";
import { getKioskAttendanceState } from "@/lib/kiosk-attendance-state";

const identifySchema = z.object({
  descriptor: z.custom<number[]>(isFaceDescriptor),
});

export async function POST(request: Request) {
  try {
    const device = await authorizeKioskDevice(request);
    if (!device)
      return NextResponse.json(
        { error: "This kiosk is not authorized. Contact an administrator." },
        { status: 401 },
      );
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
    const { descriptor } = identifySchema.parse(await request.json());
    getFaceEncryptionKey();
    const db = await getDb();
    const employee = await matchEmployeeFace(db, device.outletId, descriptor);
    if (!employee)
      return NextResponse.json(
        { error: "Face not recognized. Please try again or contact your manager." },
        { status: 404 },
      );
    const state = await getKioskAttendanceState(
      db,
      employee,
      device.outletId,
      new Date(),
    );
    return NextResponse.json({
      employee: {
        id: employee._id.toHexString(),
        name: employee.fullName,
        code: employee.employeeCode,
      },
      nextAction: state.action,
      ...(state.message ? { message: state.message } : {}),
    });
  } catch (error) {
    return apiError(error);
  }
}
