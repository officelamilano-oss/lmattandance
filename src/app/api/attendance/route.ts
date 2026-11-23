import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import {
  getActor,
  assertOutletAccess,
  scopedOutletQuery,
} from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { attendanceSchema } from "@/lib/validation/business";
import { dateOnlySchema } from "@/lib/validation/common";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import {
  getLatestAttendanceEntries,
  getLatestAttendanceEntry,
} from "@/lib/payroll/calculate";
import {
  attendanceEntryVersionMatches,
  isAttendanceEntryLocked,
  isAttendanceOutletSubmitted,
} from "@/lib/attendance";
import type {
  AttendanceDayDocument,
  EmployeeDocument,
  OutletDocument,
} from "@/lib/models";

export async function GET(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (!actor.permissions.includes("attendance.read"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const url = new URL(request.url);
    const outletId = url.searchParams.get("outletId");
    const date = url.searchParams.get("date");
    if (!date || !dateOnlySchema.safeParse(date).success)
      return NextResponse.json(
        { error: "A valid YYYY-MM-DD date is required." },
        { status: 400 },
      );
    const db = await getDb();
    if (!outletId) {
      const outlets = await db
        .collection<OutletDocument>("outlets")
        .find({ ...scopedOutletQuery(actor), active: true })
        .sort({ code: 1 })
        .toArray();
      const outletIds = outlets.map((outlet) => outlet._id);
      const days = await db
        .collection<AttendanceDayDocument>("attendance")
        .find({ outletId: { $in: outletIds }, date })
        .toArray();
      const historicalEmployeeIds = days.flatMap((day) =>
        [
          ...day.entries.map((entry) => entry.employeeId),
          ...(day.employeeCorrectionCounts ?? []).map(
            (item) => item.employeeId,
          ),
        ],
      );
      const employees = outletIds.length
        ? await db
            .collection<EmployeeDocument>("employees")
            .find(
              {
                outletId: { $in: outletIds },
                $or: [
                  { active: true },
                  { _id: { $in: historicalEmployeeIds } },
                ],
              },
              {
                projection: {
                  employeeCode: 1,
                  fullName: 1,
                  designation: 1,
                  outletId: 1,
                  active: 1,
                },
              })
            .sort({ outletId: 1, employeeCode: 1 })
            .toArray()
        : [];
      const outletById = new Map(
        outlets.map((outlet) => [outlet._id.toHexString(), outlet]),
      );
      const dayByOutletId = new Map(
        days.map((day) => [day.outletId.toHexString(), day]),
      );
      const correctionCountsByEmployee = new Map(
        days.flatMap((day) =>
          (day.employeeCorrectionCounts ?? []).map((item) => [
            item.employeeId.toHexString(),
            item.correctionCount,
          ]),
        ),
      );
      const counts = { P: 0, A: 0, WO: 0, HD: 0 };
      for (const day of days)
        for (const entry of getLatestAttendanceEntries(day.entries, {
          outletId: day.outletId.toHexString(),
          date: day.date,
        }))
          counts[entry.status] += 1;
      return NextResponse.json({
        counts,
        outletCount: outlets.length,
        submittedCount: outlets.filter((outlet) =>
          isAttendanceOutletSubmitted(
            dayByOutletId.get(outlet._id.toHexString()),
            employees.filter(
              (employee) =>
                employee.outletId.equals(outlet._id) && employee.active,
            ),
          ),
        ).length,
        employees: employees.map((employee) => {
          const outlet = outletById.get(employee.outletId.toHexString());
          const day = dayByOutletId.get(employee.outletId.toHexString());
          const entry = day
            ? getLatestAttendanceEntry(
                day.entries,
                employee._id.toHexString(),
                { outletId: day.outletId.toHexString(), date: day.date },
              )
            : undefined;
          return {
            _id: employee._id,
            employeeCode: employee.employeeCode,
            fullName: employee.fullName,
            designation: employee.designation,
            outletId: employee.outletId,
            outletCode: outlet?.code,
            outletName: outlet?.name,
            attendanceStatus: entry?.status ?? null,
            savedAttendanceStatus: entry?.status ?? null,
            attendanceEntryExists: !!entry,
            attendanceEntryUpdatedAt: entry?.updatedAt?.toISOString() ?? null,
            attendanceSubmitted:
              !!entry &&
              day?.status === "SUBMITTED" &&
              entry.submitted !== false,
            attendanceCorrectionCount:
              entry?.correctionCount ??
              correctionCountsByEmployee.get(employee._id.toHexString()) ??
              0,
          };
        }),
      });
    }
    if (!ObjectId.isValid(outletId))
      return NextResponse.json({ error: "Invalid outlet ID." }, { status: 400 });
    assertOutletAccess(actor, outletId);
    const outlet = await db
      .collection<OutletDocument>("outlets")
      .findOne({ _id: new ObjectId(outletId) });
    if (!outlet) throw new Error("NOT_FOUND");
    const day = await db
      .collection<AttendanceDayDocument>("attendance")
      .findOne({ outletId: outlet._id, date });
    const historicalEmployeeIds = [
      ...(day?.entries ?? []).map((entry) => entry.employeeId),
      ...(day?.employeeCorrectionCounts ?? []).map(
        (item) => item.employeeId,
      ),
    ];
    const employees = await db
      .collection<EmployeeDocument>("employees")
      .find(
        {
          outletId: outlet._id,
          $or: [{ active: true }, { _id: { $in: historicalEmployeeIds } }],
        },
        {
          projection: {
            employeeCode: 1,
            fullName: 1,
            designation: 1,
            outletId: 1,
            ...(actor.role === "OUTLET_USER" ? {} : { mobile: 1 }),
          },
        })
      .sort({ employeeCode: 1 })
      .toArray();
    const entries = new Map(
      (day?.entries ?? []).map((entry) => [
        entry.employeeId.toHexString(),
        entry,
      ]),
    );
    const correctionCountsByEmployee = new Map(
      (day?.employeeCorrectionCounts ?? []).map((item) => [
        item.employeeId.toHexString(),
        item.correctionCount,
      ]),
    );
    const counts = { P: 0, A: 0, WO: 0, HD: 0 };
    for (const entry of entries.values()) counts[entry.status] += 1;
    return NextResponse.json({
      outlet: { id: outlet._id, code: outlet.code, name: outlet.name },
      day,
      counts,
      employees: employees.map((employee) => ({
        _id: employee._id,
        employeeCode: employee.employeeCode,
        fullName: employee.fullName,
        designation: employee.designation,
        outletId: employee.outletId,
        outletCode: outlet.code,
        outletName: outlet.name,
        ...(actor.role === "OUTLET_USER" ? {} : { mobile: employee.mobile }),
        attendanceStatus:
          entries.get(employee._id.toHexString())?.status ?? null,
        savedAttendanceStatus:
          entries.get(employee._id.toHexString())?.status ?? null,
        attendanceEntryExists: entries.has(employee._id.toHexString()),
        attendanceEntryUpdatedAt:
          entries.get(employee._id.toHexString())?.updatedAt?.toISOString() ??
          null,
        attendanceSubmitted:
          !!entries.get(employee._id.toHexString()) &&
          day?.status === "SUBMITTED" &&
          entries.get(employee._id.toHexString())?.submitted !== false,
        attendanceCorrectionCount:
          entries.get(employee._id.toHexString())?.correctionCount ??
            correctionCountsByEmployee.get(employee._id.toHexString()) ??
            0,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  return handleAttendancePut(request, 0);
}

async function handleAttendancePut(
  request: Request,
  retryCount: number,
  bodyOverride?: unknown,
) {
  let parsedBody = bodyOverride;
  let hasParsedBody = retryCount > 0;
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (!actor.permissions.includes("attendance.write"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const body = (hasParsedBody
      ? parsedBody
      : await readJson<unknown>(request)) as { action?: string };
    parsedBody = body;
    hasParsedBody = true;
    const input = attendanceSchema.parse(body);
    if (body.action !== "SAVE" && body.action !== "SUBMIT")
      return NextResponse.json(
        { error: "Action must be SAVE or SUBMIT." },
        { status: 400 },
      );
    if (
      body.action === "SUBMIT" &&
      !actor.permissions.includes("attendance.submit")
    )
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const outletId = new ObjectId(input.outletId);
    assertOutletAccess(actor, outletId);
    const db = await getDb();
    const settings = await db
      .collection<{ _id: string; timezone?: string }>("settings")
      .findOne({ _id: "payroll" });
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone:
        settings?.timezone || process.env.BUSINESS_TIMEZONE || "Asia/Kolkata",
    }).format(new Date());
    if (input.date > today)
      return NextResponse.json(
        { error: "Attendance cannot be recorded for a future date." },
        { status: 400 },
      );
    const outlet = await db
      .collection<OutletDocument>("outlets")
      .findOne({ _id: outletId });
    if (!outlet)
      return NextResponse.json(
        { error: "Outlet is unavailable." },
        { status: 400 },
      );
    const collection = db.collection<AttendanceDayDocument>("attendance");
    const existingDay = await collection.findOne({
      outletId,
      date: input.date,
    });
    if (!outlet.active && (!existingDay || actor.role !== "MAIN_ADMIN"))
      return NextResponse.json(
        { error: "Inactive outlets cannot receive new attendance." },
        { status: 400 },
      );
    const historicalEmployeeIds = [
      ...(existingDay?.entries ?? []).map((entry) => entry.employeeId),
      ...(existingDay?.employeeCorrectionCounts ?? []).map(
        (item) => item.employeeId,
      ),
    ];
    const historicalEmployeeIdSet = new Set(
      historicalEmployeeIds.map((employeeId) => employeeId.toHexString()),
    );
    const requestedEmployeeIds = [
      ...input.entries.map((entry) => entry.employeeId),
      ...input.clearEmployeeIds,
    ];
    const requestedObjectIds = [
      ...new Set(requestedEmployeeIds),
    ].map((employeeId) => new ObjectId(employeeId));
    const employees = await db
      .collection<EmployeeDocument>("employees")
      .find(
        {
          outletId,
          _id: { $in: requestedObjectIds },
        },
        { projection: { _id: 1, active: 1, fullName: 1 } },
      )
      .toArray();
    const now = new Date();
    const wasUnlocked = existingDay?.corrections.at(-1)?.action === "UNLOCK";
    if (body.action === "SUBMIT" && input.entries.length === 0)
      return NextResponse.json(
        { error: "Mark at least one employee before submitting attendance." },
        { status: 400 },
      );
    const previousEntries = new Map(
      (existingDay?.entries ?? []).map((entry) => [
        entry.employeeId.toHexString(),
        entry,
      ]),
    );
    const correctionCounts = new Map(
      (existingDay?.employeeCorrectionCounts ?? []).map((item) => [
        item.employeeId.toHexString(),
        item.correctionCount,
      ]),
    );
    const employeeById = new Map(
      employees.map((employee) => [employee._id.toHexString(), employee]),
    );
    const versionsByEmployee = new Map<string, string>();
    const duplicateVersionIds = new Set<string>();
    for (const version of input.versions) {
      if (versionsByEmployee.has(version.employeeId))
        duplicateVersionIds.add(version.employeeId);
      else
        versionsByEmployee.set(
          version.employeeId,
          version.updatedAt ?? "",
        );
    }
    const employeeIdCounts = new Map<string, number>();
    for (const employeeId of requestedEmployeeIds)
      employeeIdCounts.set(
        employeeId,
        (employeeIdCounts.get(employeeId) ?? 0) + 1,
      );
    const failures: Array<{
      employeeId: string;
      employeeName: string;
      reason: string;
    }> = [];
    const failedEmployeeIds = new Set<string>();
    const rejectEmployee = (employeeId: string, reason: string) => {
      if (failedEmployeeIds.has(employeeId)) return;
      failedEmployeeIds.add(employeeId);
      failures.push({
        employeeId,
        employeeName:
          employeeById.get(employeeId)?.fullName ?? `Employee ${employeeId}`,
        reason,
      });
    };
    for (const employeeId of new Set(requestedEmployeeIds)) {
      const employee = employeeById.get(employeeId);
      if ((employeeIdCounts.get(employeeId) ?? 0) > 1) {
        rejectEmployee(employeeId, "Employee appears more than once in this save.");
        continue;
      }
      if (
        !employee ||
        (!employee.active && !historicalEmployeeIdSet.has(employeeId))
      ) {
        rejectEmployee(
          employeeId,
          "Employee is inactive or does not belong to the selected outlet.",
        );
        continue;
      }
      if (duplicateVersionIds.has(employeeId)) {
        rejectEmployee(employeeId, "Employee version was provided more than once.");
        continue;
      }
      if (!versionsByEmployee.has(employeeId)) {
        rejectEmployee(employeeId, "Employee version is missing. Refresh and retry.");
        continue;
      }
      const expectedUpdatedAt = versionsByEmployee.get(employeeId) || null;
      const actualUpdatedAt = previousEntries.get(employeeId)?.updatedAt;
      if (!attendanceEntryVersionMatches(expectedUpdatedAt, actualUpdatedAt)) {
        console.warn("Attendance employee version mismatch", {
          outletId: outletId.toHexString(),
          date: input.date,
          employeeId,
          expectedUpdatedAt,
          actualUpdatedAt: actualUpdatedAt?.toISOString() ?? null,
        });
        rejectEmployee(
          employeeId,
          "This employee's attendance changed since it was loaded. Refresh and retry.",
        );
      }
    }
    const isSubmittedEntry = (employeeId: string) => {
      const previous = previousEntries.get(employeeId);
      return (
        !!previous &&
        existingDay?.status === "SUBMITTED" &&
        previous.submitted !== false
      );
    };
    let hasAdminSubmittedCorrection = false;
    const validEntries: typeof input.entries = [];
    for (const entry of input.entries) {
      if (failedEmployeeIds.has(entry.employeeId)) continue;
      const previous = previousEntries.get(entry.employeeId);
      const isAlreadySubmitted = isSubmittedEntry(entry.employeeId);
      if (isAttendanceEntryLocked(isAlreadySubmitted, actor.role)) {
        rejectEmployee(
          entry.employeeId,
          "Submitted attendance cannot be changed or submitted again.",
        );
        continue;
      }
      if (
        isAlreadySubmitted &&
        previous?.status !== entry.status &&
        actor.role === "MAIN_ADMIN"
      ) {
        if (!input.reason) {
          rejectEmployee(
            entry.employeeId,
            "A correction reason is required to change submitted attendance.",
          );
          continue;
        }
        hasAdminSubmittedCorrection = true;
      }
      const correctionCount =
        previous?.correctionCount ?? correctionCounts.get(entry.employeeId) ?? 0;
      if (
        wasUnlocked &&
        actor.role !== "MAIN_ADMIN" &&
        previous?.status !== entry.status &&
        correctionCount >= 2
      ) {
        rejectEmployee(
          entry.employeeId,
          "Attendance is locked after 2 changes for this date. Contact MAIN_ADMIN for further corrections.",
        );
        continue;
      }
      validEntries.push(entry);
    }
    const validClearEmployeeIds: string[] = [];
    for (const employeeId of input.clearEmployeeIds) {
      if (failedEmployeeIds.has(employeeId)) continue;
      const previous = previousEntries.get(employeeId);
      if (!previous) continue;
      const isAlreadySubmitted = isSubmittedEntry(employeeId);
      if (isAttendanceEntryLocked(isAlreadySubmitted, actor.role)) {
        rejectEmployee(
          employeeId,
          "Submitted attendance cannot be changed or deleted.",
        );
        continue;
      }
      if (isAlreadySubmitted && actor.role === "MAIN_ADMIN") {
        if (!input.reason) {
          rejectEmployee(
            employeeId,
            "A correction reason is required to change submitted attendance.",
          );
          continue;
        }
        hasAdminSubmittedCorrection = true;
      }
      const correctionCount =
        previous.correctionCount ?? correctionCounts.get(employeeId) ?? 0;
      if (
        wasUnlocked &&
        actor.role !== "MAIN_ADMIN" &&
        correctionCount >= 2
      ) {
        rejectEmployee(
          employeeId,
          "Attendance is locked after 2 changes for this date. Contact MAIN_ADMIN for further corrections.",
        );
        continue;
      }
      validClearEmployeeIds.push(employeeId);
    }
    if (failures.length)
      console.warn("Attendance employee validation failed", {
        outletId: outletId.toHexString(),
        date: input.date,
        action: body.action,
        failures: failures.map(({ employeeId, reason }) => ({
          employeeId,
          reason,
        })),
      });
    const appliedEmployeeIds = new Set([
      ...validEntries.map((entry) => entry.employeeId),
      ...validClearEmployeeIds.filter((employeeId) =>
        previousEntries.has(employeeId),
      ),
    ]);
    if (!appliedEmployeeIds.size)
      return NextResponse.json({
        day: existingDay,
        savedEmployeeCount: 0,
        submittedEmployeeCount: 0,
        failures,
      });
    const entries = new Map(
      (existingDay?.entries ?? []).map((entry) => [
        entry.employeeId.toHexString(),
        {
          ...entry,
          correctionCount: entry.correctionCount ?? 0,
        },
      ]),
    );
    for (const entry of validEntries) {
      const previous = previousEntries.get(entry.employeeId);
      const correctionCount =
        previous?.correctionCount ?? correctionCounts.get(entry.employeeId) ?? 0;
      const changed = previous?.status !== entry.status;
      const isAlreadySubmitted = isSubmittedEntry(entry.employeeId);
      entries.set(entry.employeeId, {
        employeeId: new ObjectId(entry.employeeId),
        status: entry.status,
        updatedAt: now,
        updatedBy: actor.id,
        correctionCount:
          (wasUnlocked || isAlreadySubmitted) && changed
            ? correctionCount + 1
            : correctionCount,
        submitted:
          isAlreadySubmitted ||
          (body.action === "SUBMIT" && validEntries.length > 0),
      });
      correctionCounts.delete(entry.employeeId);
    }
    for (const employeeId of validClearEmployeeIds) {
      const previous = previousEntries.get(employeeId);
      if (!previous) continue;
      const correctionCount =
        previous.correctionCount ?? correctionCounts.get(employeeId) ?? 0;
      entries.delete(employeeId);
      if (wasUnlocked || isSubmittedEntry(employeeId))
        correctionCounts.set(employeeId, correctionCount + 1);
      else if (correctionCount) correctionCounts.set(employeeId, correctionCount);
      else correctionCounts.delete(employeeId);
    }
    const hasSubmittedEntries = [...entries.values()].some(
      (entry) =>
        entry.submitted ||
        (existingDay?.status === "SUBMITTED" && entry.submitted !== false),
    );
    const shouldSubmitEntries =
      body.action === "SUBMIT" && validEntries.length > 0;
    const shouldBeSubmitted = shouldSubmitEntries || hasSubmittedEntries;
    const correctionEvents = [
      ...(hasAdminSubmittedCorrection
        ? [
            {
              at: now,
              actorId: actor.id,
              reason: input.reason!,
              action: "UNLOCK" as const,
            },
            {
              at: now,
              actorId: actor.id,
              reason: input.reason!,
              action: "RELOCK" as const,
            },
          ]
        : []),
      ...(shouldSubmitEntries && wasUnlocked
        ? [
            {
              at: now,
              actorId: actor.id,
              reason: input.reason || "Attendance re-submitted after correction",
              action: "RELOCK" as const,
            },
          ]
        : []),
    ];
    const update = {
      $set: {
        entries: [...entries.values()],
        employeeCorrectionCounts: [...correctionCounts].map(
          ([employeeId, correctionCount]) => ({
            employeeId: new ObjectId(employeeId),
            correctionCount,
          }),
        ),
        updatedAt: now,
        updatedBy: actor.id,
        ...(shouldBeSubmitted
          ? {
              status: "SUBMITTED" as const,
              ...(shouldSubmitEntries
                ? { submittedAt: now, submittedBy: actor.id }
                : {}),
            }
          : { status: "DRAFT" as const }),
      },
      $setOnInsert: {
        _id: new ObjectId(),
        outletId,
        date: input.date,
        ...(!correctionEvents.length ? { corrections: [] } : {}),
      },
      ...(correctionEvents.length
        ? {
            $push: {
              corrections: { $each: correctionEvents },
            },
          }
        : {}),
    };
    const writeFilter = {
      outletId,
      date: input.date,
      ...(existingDay
        ? {
            _id: existingDay._id,
            ...(existingDay.updatedAt
              ? { updatedAt: existingDay.updatedAt }
              : {
                  $or: [
                    { updatedAt: { $exists: false } },
                    { updatedAt: { $type: "null" as const } },
                  ],
                }),
          }
        : { status: { $ne: "SUBMITTED" as const } }),
    };
    const logFilter = {
      outletId: outletId.toHexString(),
      date: input.date,
      ...(existingDay
        ? {
            _id: existingDay._id.toHexString(),
            ...(existingDay.updatedAt
              ? { updatedAt: existingDay.updatedAt.toISOString() }
              : {
                  $or: [
                    { updatedAt: { $exists: false } },
                    { updatedAt: { $type: "null" as const } },
                  ],
                }),
          }
        : { status: { $ne: "SUBMITTED" as const } }),
    };
    const reportWriteConflict = async (
      reason: string,
      extra: Record<string, unknown> = {},
    ) => {
      const latestDay = await collection.findOne({
        outletId,
        date: input.date,
      });
      const latestEntries = new Map(
        (latestDay?.entries ?? []).map((entry) => [
          entry.employeeId.toHexString(),
          entry,
        ]),
      );
      const diagnostic = {
        reason,
        outletId: outletId.toHexString(),
        date: input.date,
        attempts: retryCount + 1,
        filter: logFilter,
        currentRecord: latestDay
          ? {
              id: latestDay._id.toHexString(),
              status: latestDay.status,
              updatedAt:
                latestDay.updatedAt instanceof Date
                  ? latestDay.updatedAt.toISOString()
                  : String(latestDay.updatedAt ?? "missing"),
            }
          : null,
        employeeVersions: [...new Set(requestedEmployeeIds)].map(
          (employeeId) => ({
            name:
              employeeById.get(employeeId)?.fullName ??
              `Employee ${employeeId}`,
            expectedUpdatedAt:
              versionsByEmployee.get(employeeId) || null,
            actualUpdatedAt:
              latestEntries.get(employeeId)?.updatedAt instanceof Date
                ? latestEntries.get(employeeId)?.updatedAt.toISOString()
                : String(
                    latestEntries.get(employeeId)?.updatedAt ?? "missing",
                  ),
          }),
        ),
        ...extra,
      };
      console.error("Attendance write could not be completed", diagnostic);
      return NextResponse.json(
        {
          error: "Attendance could not be saved.",
          details: JSON.stringify(diagnostic),
        },
        { status: 409 },
      );
    };
    let result;
    try {
      result = await collection.updateOne(
        writeFilter,
        update,
        { upsert: !existingDay },
      );
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        console.error("Attendance write hit a unique-key conflict", {
          filter: logFilter,
          upsert: !existingDay,
          retryCount,
          keyPattern: (error as { keyPattern?: unknown }).keyPattern,
          keyValue: (error as { keyValue?: unknown }).keyValue,
        });
        if (retryCount < 2 && hasParsedBody)
          return handleAttendancePut(request, retryCount + 1, parsedBody);
        return reportWriteConflict("UNIQUE_KEY_CONFLICT", {
          keyPattern: (error as { keyPattern?: unknown }).keyPattern,
          keyValue: (error as { keyValue?: unknown }).keyValue,
        });
      }
      throw error;
    }
    if (!result.matchedCount && !result.upsertedCount) {
      console.warn("Attendance optimistic-lock condition did not match", {
        filter: logFilter,
        upsert: !existingDay,
        retryCount,
      });
      if (retryCount < 2 && hasParsedBody)
        return handleAttendancePut(request, retryCount + 1, parsedBody);
      return reportWriteConflict("CONDITIONAL_UPDATE_MATCHED_ZERO");
    }
    const record = await db
      .collection<AttendanceDayDocument>("attendance")
      .findOne({ outletId, date: input.date });
    if (shouldSubmitEntries && record)
      await writeAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: "ATTENDANCE_SUBMITTED",
        entityType: "attendance",
        entityId: record._id.toHexString(),
        outletId,
      });
    if (hasAdminSubmittedCorrection && record)
      await writeAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: "ATTENDANCE_CORRECTED",
        entityType: "attendance",
        entityId: record._id.toHexString(),
        outletId,
        reason: input.reason,
      });
    return NextResponse.json({
      day: record,
      savedEmployeeCount: appliedEmployeeIds.size,
      submittedEmployeeCount: shouldSubmitEntries ? validEntries.length : 0,
      failures,
    });
  } catch (error) {
    return apiError(error);
  }
}
