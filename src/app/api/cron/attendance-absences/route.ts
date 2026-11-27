import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ensureEmployeeAbsent } from "@/lib/auto-absence";
import { getLocalClock, getShiftDateDueForAbsence } from "@/lib/attendance-shifts";
import { getDb } from "@/lib/mongodb";
import type { EmployeeDocument, SalarySettings } from "@/lib/models";
import type { OutletSettingsDocument } from "@/lib/outlet-settings";

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = /^Bearer (.+)$/.exec(authorization)?.[1];
  if (!secret || !supplied) return false;
  const expectedBuffer = Buffer.from(secret);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET)
    return NextResponse.json(
      { error: "Automatic absence scheduling is unavailable until CRON_SECRET is configured." },
      { status: 503 },
    );
  if (!isAuthorized(request))
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const db = await getDb();
    const settings = await db
      .collection<SalarySettings & { _id: string }>("settings")
      .findOne({ _id: "payroll" });
    const timezone =
      settings?.timezone ?? process.env.BUSINESS_TIMEZONE ?? "Asia/Kolkata";
    const now = new Date();
    const clock = getLocalClock(now, timezone);
    const outlets = await db
      .collection<OutletSettingsDocument>("outlets")
      .find({ active: true }, { projection: { _id: 1 } })
      .toArray();
    if (!outlets.length) return NextResponse.json({ markedAbsent: 0 });
    const employees = await db
      .collection<EmployeeDocument>("employees")
      .find(
        {
          active: true,
          outletId: { $in: outlets.map((outlet) => outlet._id) },
          shiftStartTime: { $type: "string" },
          shiftEndTime: { $type: "string" },
        },
        {
          projection: {
            _id: 1,
            outletId: 1,
            dateOfJoining: 1,
            shiftStartTime: 1,
          },
        },
      )
      .toArray();
    let markedAbsent = 0;
    for (const employee of employees) {
      if (!employee.shiftStartTime) continue;
      const date = getShiftDateDueForAbsence(clock, employee.shiftStartTime);
      if (!date || employee.dateOfJoining > date) continue;
      const result = await ensureEmployeeAbsent(db, {
        outletId: employee.outletId,
        employeeId: employee._id,
        date,
        now,
      });
      if (result.marked) markedAbsent += 1;
    }
    return NextResponse.json({ markedAbsent, checkedAt: now.toISOString() });
  } catch (error) {
    console.error("Automatic absence run failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "Automatic absence run failed." },
      { status: 500 },
    );
  }
}
