import ExcelJS from "exceljs";
import { ObjectId } from "mongodb";
import { connection, NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import type {
  EmployeeDocument,
  FaceAttendanceLogDocument,
  OutletDocument,
} from "@/lib/models";
import { dateOnlySchema } from "@/lib/validation/common";
import {
  formatFaceAttendanceDuration,
  getFaceAttendanceDurationSeconds,
  getFaceAttendanceStatus,
  type FaceAttendanceStatus,
} from "@/lib/face-attendance-report";
import {
  ensureFaceAttendanceLogIndexes,
  getIndiaDateRange,
} from "@/lib/face-attendance-logs";

const pageSizeValues = [10, 25, 50, 100] as const;
const sortFields = new Set([
  "clockIn",
  "clockOut",
  "employeeName",
  "employeeCode",
  "outletName",
  "totalHours",
  "statusTag",
  "createdAt",
  "daysPunched",
  "averageHours",
  "openEntries",
]);

type FaceAttendanceReportRow = FaceAttendanceLogDocument & {
  durationSeconds: number | null;
  statusTag: FaceAttendanceStatus;
};

export async function GET(request: Request) {
  try {
    await connection();
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (
      actor.role !== "MAIN_ADMIN" &&
      !actor.permissions.includes("employees.read")
    )
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const url = new URL(request.url);
    const db = await getDb();
    await ensureFaceAttendanceLogIndexes(db);
    const outletValues = url.searchParams.getAll("outletId");
    const employeeValues = url.searchParams.getAll("employeeId");
    if (
      [...outletValues, ...employeeValues].some(
        (value) => !/^[a-f\d]{24}$/i.test(value),
      )
    )
      return NextResponse.json(
        { error: "Invalid outlet or employee ID." },
        { status: 400 },
      );
    const requestedOutlets = parseIds(outletValues);
    const requestedEmployees = parseIds(employeeValues);
    const allowedOutletIds =
      actor.role === "MAIN_ADMIN"
        ? requestedOutlets
        : intersectIds(actor.outletIds, requestedOutlets);

    for (const outletId of requestedOutlets ?? [])
      assertOutletAccess(actor, outletId);

    if (url.searchParams.get("options") === "1") {
      const outlets = await db
        .collection<OutletDocument>("outlets")
        .find({
          active: true,
          ...(allowedOutletIds
            ? { _id: { $in: allowedOutletIds } }
            : actor.role === "MAIN_ADMIN"
              ? {}
              : { _id: { $in: actor.outletIds } }),
        })
        .sort({ code: 1 })
        .toArray();
      const selectedOutletIds =
        allowedOutletIds ?? outlets.map((outlet) => outlet._id);
      const employees = selectedOutletIds.length
        ? await db
            .collection<EmployeeDocument>("employees")
            .find(
              { outletId: { $in: selectedOutletIds } },
              {
                projection: {
                  employeeCode: 1,
                  fullName: 1,
                  outletId: 1,
                  active: 1,
                },
              },
            )
            .sort({ fullName: 1 })
            .toArray()
        : [];
      return NextResponse.json({
        outlets: outlets.map((outlet) => ({
          id: outlet._id.toHexString(),
          code: outlet.code,
          name: outlet.name,
        })),
        employees: employees.map((employee) => ({
          id: employee._id.toHexString(),
          code: employee.employeeCode,
          name: employee.fullName,
          outletId: employee.outletId.toHexString(),
          active: employee.active,
        })),
      });
    }

    const from = dateOnlySchema.parse(url.searchParams.get("from"));
    const to = dateOnlySchema.parse(url.searchParams.get("to"));
    if (from > to)
      return NextResponse.json(
        { error: "Start date must be on or before end date." },
        { status: 400 },
      );
    const daySpan =
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000 +
      1;
    if (daySpan > 367)
      return NextResponse.json(
        { error: "Face log ranges are limited to 367 calendar days." },
        { status: 400 },
      );
    if (
      (requestedEmployees?.length ?? 0) > 5000 ||
      (requestedOutlets?.length ?? 0) > 100
    )
      return NextResponse.json(
        { error: "Too many selected employees or outlets." },
        { status: 400 },
      );

    const { start, endExclusive } = getIndiaDateRange(from, to);
    const match: Record<string, unknown> = {
      $or: [
        { clockIn: { $gte: start, $lt: endExclusive } },
        {
          clockIn: { $exists: false },
          clockOut: { $gte: start, $lt: endExclusive },
        },
      ],
      ...(allowedOutletIds
        ? { outletId: { $in: allowedOutletIds } }
        : actor.role === "MAIN_ADMIN"
          ? {}
          : { outletId: { $in: actor.outletIds } }),
      ...(requestedEmployees?.length
        ? { employeeId: { $in: requestedEmployees } }
        : {}),
    };
    const search = (url.searchParams.get("search") ?? "").trim().slice(0, 100);
    if (search) {
      const expression = new RegExp(escapeRegex(search), "i");
      match.$and = [
        {
          $or: [
            { employeeName: expression },
            { employeeCode: expression },
            { outletName: expression },
            { outletCode: expression },
            { companyName: expression },
          ],
        },
      ];
    }

    const page = Math.max(1, Math.min(1_000_000, Number(url.searchParams.get("page") ?? 1) || 1));
    const requestedPageSize = Number(url.searchParams.get("pageSize") ?? 25);
    const pageSize = pageSizeValues.includes(
      requestedPageSize as (typeof pageSizeValues)[number],
    )
      ? requestedPageSize
      : 25;
    const sort = sortFields.has(url.searchParams.get("sort") ?? "")
      ? url.searchParams.get("sort")!
      : "clockIn";
    const direction = url.searchParams.get("direction") === "asc" ? 1 : -1;
    const format = url.searchParams.get("format");
    const collection = db.collection<FaceAttendanceLogDocument>(
      "face_attendance_logs",
    );
    const computedStages = buildComputedStages();
    const summary = await collection
      .aggregate<{
        totalEntries: number;
        totalSeconds: number;
        openEntries: number;
      }>([
        { $match: match },
        ...computedStages,
        {
          $group: {
            _id: null,
            totalEntries: { $sum: 1 },
            totalSeconds: { $sum: { $ifNull: ["$durationSeconds", 0] } },
            openEntries: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: [{ $type: "$clockIn" }, "date"] },
                      { $eq: [{ $type: "$clockOut" }, "missing"] },
                      { $ne: ["$missingClockOut", true] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ])
      .toArray();
    const summaryCounts = summary[0] ?? {
      totalEntries: 0,
      totalSeconds: 0,
      openEntries: 0,
    };

    if (format && ["csv", "xlsx", "pdf", "copy"].includes(format)) {
      const logs = await collection
        .aggregate<FaceAttendanceLogDocument>([
          { $match: match },
          { $sort: sortDefinition(sort, direction) },
        ])
        .toArray();
      const rows = logs.map(toReportRow);
      const exportRows = rows.map(toExportRow);
      if (format === "csv")
        return new NextResponse(toCsv(exportRows), {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="face-attendance-log_${from}_${to}.csv"`,
            "Cache-Control": "no-store",
          },
        });
      if (format === "copy")
        return new NextResponse(toTsv(exportRows), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      if (format === "xlsx")
        return xlsxResponse(exportRows, from, to);
      return new NextResponse(
        printHtml(
          exportRows,
          from,
          to,
          await selectedLabels(
            db,
            actor.role === "MAIN_ADMIN" ? undefined : actor.outletIds,
            requestedOutlets,
            requestedEmployees,
          ),
        ),
        {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Disposition": `inline; filename="face-attendance-log_${from}_${to}.html"`,
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const view = url.searchParams.get("view") === "summary" ? "summary" : "logs";
    if (view === "summary") {
      const employeeSummary = await collection
        .aggregate<{
          _id: ObjectId;
          employeeCode: string;
          employeeName: string;
          outletCode: string;
          outletName: string;
          shiftDurationHours?: number;
          entries: number;
          totalSeconds: number;
          openEntries: number;
          days: string[];
          daysPunched: number;
          averageSecondsPerDay: number;
        }>([
          { $match: match },
          ...computedStages,
          {
            $group: {
              _id: "$employeeId",
              employeeCode: { $first: "$employeeCode" },
              employeeName: { $first: "$employeeName" },
              outletCode: { $first: "$outletCode" },
              outletName: { $first: "$outletName" },
              shiftDurationHours: { $first: "$shiftDurationHours" },
              entries: { $sum: 1 },
              totalSeconds: { $sum: { $ifNull: ["$durationSeconds", 0] } },
              openEntries: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: [{ $type: "$clockIn" }, "date"] },
                        { $eq: [{ $type: "$clockOut" }, "missing"] },
                        { $ne: ["$missingClockOut", true] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              days: {
                $addToSet: {
                  $cond: [
                    { $eq: [{ $type: "$clockIn" }, "date"] },
                    {
                      $dateToString: {
                        date: "$clockIn",
                        format: "%Y-%m-%d",
                        timezone: "Asia/Kolkata",
                      },
                    },
                    null,
                  ],
                },
              },
            },
          },
          { $addFields: { days: { $filter: { input: "$days", as: "day", cond: { $ne: ["$$day", null] } } } } },
          {
            $addFields: {
              daysPunched: { $size: "$days" },
              averageSecondsPerDay: {
                $cond: [
                  { $gt: [{ $size: "$days" }, 0] },
                  { $divide: ["$totalSeconds", { $size: "$days" }] },
                  0,
                ],
              },
            },
          },
          { $sort: summarySortDefinition(sort, direction) },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
        ])
        .toArray();
      const totalEmployees = await collection
        .aggregate<{ count: number }>([
          { $match: match },
          { $group: { _id: "$employeeId" } },
          { $count: "count" },
        ])
        .toArray();
      const rows = employeeSummary.map((item) => ({
        employeeId: item._id.toHexString(),
        employeeCode: item.employeeCode,
        employeeName: item.employeeName,
        outletCode: item.outletCode,
        outletName: item.outletName,
        shiftHours: item.shiftDurationHours ?? null,
        daysPunched: item.daysPunched,
        entries: item.entries,
        totalSeconds: item.totalSeconds,
        averageSecondsPerDay: item.averageSecondsPerDay,
        openEntries: item.openEntries,
      }));
      return NextResponse.json({
        view,
        rows,
        page,
        pageSize,
        total: totalEmployees[0]?.count ?? 0,
        summary: summaryCounts,
      });
    }

    const result = await collection
      .aggregate<FaceAttendanceLogDocument>([
        { $match: match },
        ...computedStages,
        { $sort: sortDefinition(sort, direction) },
        { $skip: (page - 1) * pageSize },
        { $limit: pageSize },
      ])
      .toArray();
    const editorIds = result.flatMap((log) => (log.editedBy ? [log.editedBy] : []));
    const editors = editorIds.length
      ? await db
          .collection<{ _id: ObjectId; name?: string; email: string }>("users")
          .find(
            { _id: { $in: editorIds } },
            { projection: { name: 1, email: 1 } },
          )
          .toArray()
      : [];
    const editorById = new Map(
      editors.map((editor) => [
        editor._id.toHexString(),
        { name: editor.name ?? editor.email, email: editor.email },
      ]),
    );
    const rows = result
      .map(toReportRow)
      .map(serializeRow)
      .map((log) => ({
        ...log,
        editor: log.editedBy
          ? editorById.get(log.editedBy as string) ?? null
          : null,
      }));
    return NextResponse.json({
      view,
      rows,
      page,
      pageSize,
      total: summaryCounts.totalEntries,
      summary: summaryCounts,
    });
  } catch (error) {
    return apiError(error);
  }
}

function parseIds(values: string[]) {
  return values.length ? [...new Set(values)].map((value) => new ObjectId(value)) : undefined;
}

function intersectIds(allowed: ObjectId[], requested?: ObjectId[]) {
  if (!requested) return allowed;
  const allowedSet = new Set(allowed.map((id) => id.toHexString()));
  return requested.filter((id) => allowedSet.has(id.toHexString()));
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildComputedStages() {
  return [
    {
      $addFields: {
        durationSeconds: {
          $cond: [
            {
              $and: [
                { $eq: [{ $type: "$clockIn" }, "date"] },
                { $eq: [{ $type: "$clockOut" }, "date"] },
                { $gte: ["$clockOut", "$clockIn"] },
              ],
            },
            { $floor: { $divide: [{ $subtract: ["$clockOut", "$clockIn"] }, 1000] } },
            null,
          ],
        },
      },
    },
    {
      $addFields: {
        statusRank: {
          $switch: {
            branches: [
              { case: { $eq: ["$missingClockOut", true] }, then: 4 },
              { case: { $ne: [{ $type: "$clockIn" }, "date"] }, then: 1 },
              { case: { $eq: [{ $type: "$clockOut" }, "missing"] }, then: 2 },
              {
                case: {
                  $or: [
                    { $gt: ["$durationSeconds", 16 * 60 * 60] },
                    {
                      $lt: [
                        "$clockOut",
                        "$clockIn",
                      ],
                    },
                    {
                      $and: [
                        { $gt: ["$shiftDurationHours", 0] },
                        {
                          $gt: [
                            "$durationSeconds",
                            {
                              $multiply: [
                                { $add: ["$shiftDurationHours", 2] },
                                3600,
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                then: 3,
              },
            ],
            default: 0,
          },
        },
      },
    },
  ];
}

function sortDefinition(field: string, direction: 1 | -1) {
  const sortField =
    field === "totalHours"
      ? "durationSeconds"
      : field === "statusTag"
        ? "statusRank"
        : field;
  return { [sortField]: direction, _id: 1 as const };
}

function summarySortDefinition(field: string, direction: 1 | -1) {
  const fields: Record<string, string> = {
    employeeName: "employeeName",
    employeeCode: "employeeCode",
    outletName: "outletName",
    daysPunched: "daysPunched",
    totalHours: "totalSeconds",
    averageHours: "averageSecondsPerDay",
    openEntries: "openEntries",
  };
  return { [fields[field] ?? "employeeName"]: direction, _id: 1 as const };
}

function toReportRow(log: FaceAttendanceLogDocument): FaceAttendanceReportRow {
  const clockIn = log.clockIn ? new Date(log.clockIn) : undefined;
  const clockOut =
    log.clockOut instanceof Date ? new Date(log.clockOut) : log.clockOut;
  const normalized = { ...log, clockIn, clockOut };
  return {
    ...normalized,
    durationSeconds: getFaceAttendanceDurationSeconds(clockIn, clockOut),
    statusTag: getFaceAttendanceStatus(normalized),
  };
}

function serializeRow(log: FaceAttendanceReportRow) {
  return {
    ...log,
    _id: log._id.toHexString(),
    employeeId: log.employeeId.toHexString(),
    outletId: log.outletId.toHexString(),
    clockIn: log.clockIn?.toISOString() ?? null,
    clockOut: log.clockOut instanceof Date ? log.clockOut.toISOString() : null,
    editedBy: log.editedBy?.toHexString() ?? null,
    editedAt: log.editedAt?.toISOString() ?? null,
    createdAt: log.createdAt.toISOString(),
    updatedAt: log.updatedAt.toISOString(),
  };
}

function toExportRow(log: FaceAttendanceReportRow) {
  const totalHours = formatFaceAttendanceDuration(log.durationSeconds);
  return {
    "Sr. No.": "",
    "Company Name": log.companyName,
    "Location Name": `${log.outletCode} · ${log.outletName}`,
    "Employee Name": log.employeeName,
    "User Name": log.employeeCode,
    "Clock In": formatIstTimestamp(log.clockIn),
    "Clock Out": formatIstTimestamp(
      log.clockOut instanceof Date ? log.clockOut : undefined,
    ),
    "Total Hours": `${totalHours}${log.statusTag === "Check" ? " (Check)" : ""}`,
    "Created Date": formatIstTimestamp(log.createdAt),
  };
}

const exportHeaders = [
  "Sr. No.",
  "Company Name",
  "Location Name",
  "Employee Name",
  "User Name",
  "Clock In",
  "Clock Out",
  "Total Hours",
  "Created Date",
];

function toCsv(rows: ReturnType<typeof toExportRow>[]) {
  const cell = (value: unknown) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;
  return `\uFEFF${[
    exportHeaders.map(cell).join(","),
    ...rows.map((row, index) =>
      exportHeaders
        .map((header) =>
          cell(header === "Sr. No." ? index + 1 : row[header as keyof typeof row]),
        )
        .join(","),
    ),
  ].join("\r\n")}`;
}

function toTsv(rows: ReturnType<typeof toExportRow>[]) {
  return [
    exportHeaders.join("\t"),
    ...rows.map((row, index) =>
      exportHeaders
        .map((header) =>
          String(
            header === "Sr. No." ? index + 1 : row[header as keyof typeof row],
          ).replace(/[\t\r\n]/g, " "),
        )
        .join("\t"),
    ),
  ].join("\n");
}

async function xlsxResponse(rows: ReturnType<typeof toExportRow>[], from: string, to: string) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Face Attendance Log");
  sheet.addRow(exportHeaders);
  rows.forEach((row, index) =>
    sheet.addRow(
      exportHeaders.map((header) =>
        header === "Sr. No." ? index + 1 : row[header as keyof typeof row],
      ),
    ),
  );
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF254D46" },
  };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.columns = exportHeaders.map((header) => ({
    header,
    width: Math.min(
      30,
      Math.max(
        13,
        header.length + 2,
        ...rows.map((row) =>
          String(row[header as keyof typeof row] ?? "").length + 2,
        ),
      ),
    ),
  }));
  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="face-attendance-log_${from}_${to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

function printHtml(
  rows: ReturnType<typeof toExportRow>[],
  from: string,
  to: string,
  selections: { outlets: string; employees: string },
) {
  const cell = (value: unknown) =>
    escapeHtml(value === null || value === undefined ? "" : String(value));
  const generatedAt = formatIstTimestamp(new Date());
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>face-attendance-log_${from}_${to}</title><style>body{font:12px Arial,sans-serif;color:#222;margin:24px}h1{font-size:20px;margin:0 0 8px}p{margin:4px 0}.meta{margin-bottom:16px}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #bbb;padding:6px;text-align:left}th{background:#eee}tr:nth-child(even){background:#fafafa}@media print{body{margin:10mm}}</style></head><body><h1>Face Attendance Log Report</h1><div class="meta"><p>Date range: ${cell(from)} – ${cell(to)} (Asia/Kolkata)</p><p>Outlets: ${cell(selections.outlets)}</p><p>Employees: ${cell(selections.employees)}</p><p>Generated: ${cell(generatedAt)}</p></div><table><thead><tr>${exportHeaders.map((header) => `<th>${cell(header)}</th>`).join("")}</tr></thead><tbody>${rows
    .map(
      (row, index) =>
        `<tr>${exportHeaders
          .map((header) =>
            `<td>${cell(header === "Sr. No." ? index + 1 : row[header as keyof typeof row])}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("")}</tbody></table><script>window.addEventListener("load",()=>window.print())</script></body></html>`;
}

async function selectedLabels(
  db: Awaited<ReturnType<typeof getDb>>,
  permittedOutletIds: ObjectId[] | undefined,
  selectedOutlets: ObjectId[] | undefined,
  selectedEmployees: ObjectId[] | undefined,
) {
  const [outlets, employees] = await Promise.all([
    selectedOutlets?.length
      ? db
          .collection<OutletDocument>("outlets")
          .find({
            _id: { $in: selectedOutlets },
            ...(permittedOutletIds
              ? { _id: { $in: selectedOutlets.filter((id) => permittedOutletIds.some((allowed) => allowed.equals(id))) } }
              : {}),
          })
          .project<{ code: string; name: string }>({ code: 1, name: 1 })
          .toArray()
      : Promise.resolve([]),
    selectedEmployees?.length
      ? db
          .collection<EmployeeDocument>("employees")
          .find({
            _id: { $in: selectedEmployees },
            ...(permittedOutletIds
              ? { outletId: { $in: permittedOutletIds } }
              : {}),
          })
          .project<{ employeeCode: string; fullName: string }>({
            employeeCode: 1,
            fullName: 1,
          })
          .toArray()
      : Promise.resolve([]),
  ]);
  return {
    outlets: selectedOutlets?.length
      ? outlets.map((outlet) => `${outlet.code} · ${outlet.name}`).join(", ")
      : "All accessible outlets",
    employees: selectedEmployees?.length
      ? employees.map((employee) => `${employee.employeeCode} · ${employee.fullName}`).join(", ")
      : "All employees",
  };
}

function formatIstTimestamp(value?: Date) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "medium",
    hour12: false,
  }).format(value);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character]!;
  });
}
