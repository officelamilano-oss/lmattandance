import ExcelJS from "exceljs";
import { ObjectId, type Filter } from "mongodb";
import { NextResponse } from "next/server";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError } from "@/lib/http";
import {
  UNIFORM_ITEMS,
  UNIFORM_ITEM_LABELS,
} from "@/lib/uniform-deductions";
import type {
  EmployeeDocument,
  OutletDocument,
  UniformDeductionDocument,
} from "@/lib/models";
import { monthSchema, objectIdSchema } from "@/lib/validation/common";
import { z } from "zod";

const statusSchema = z.enum(["SCHEDULED", "APPLIED", "CANCELLED"]);

function safeText(value: string) {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export async function GET(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (
      !actor.permissions.includes("uniforms.manage") ||
      !actor.permissions.includes("reports.export")
    )
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const url = new URL(request.url);
    const format = z.enum(["xlsx", "csv"]).parse(url.searchParams.get("format") ?? "xlsx");
    const outletValue = url.searchParams.get("outletId") || undefined;
    const employeeValue = url.searchParams.get("employeeId") || undefined;
    const itemValue = url.searchParams.get("item") || undefined;
    const monthValue = url.searchParams.get("month") || undefined;
    const statusValue = url.searchParams.get("status") || undefined;
    const outletId = outletValue ? objectIdSchema.parse(outletValue) : undefined;
    const employeeId = employeeValue ? objectIdSchema.parse(employeeValue) : undefined;
    const item = itemValue ? z.enum(UNIFORM_ITEMS).parse(itemValue) : undefined;
    const month = monthValue ? monthSchema.parse(monthValue) : undefined;
    const status = statusValue ? statusSchema.parse(statusValue) : undefined;
    if (outletId) assertOutletAccess(actor, outletId);

    const db = await getDb();
    const allowedOutletIds =
      actor.role === "MAIN_ADMIN"
        ? outletId
          ? [new ObjectId(outletId)]
          : undefined
        : outletId
          ? [new ObjectId(outletId)]
          : actor.outletIds;
    const filter: Filter<UniformDeductionDocument> = {
      ...(allowedOutletIds ? { outletId: { $in: allowedOutletIds } } : {}),
      ...(employeeId ? { employeeId: new ObjectId(employeeId) } : {}),
      ...(item ? { item } : {}),
      ...(month ? { deductionMonth: month } : {}),
      ...(status ? { status } : {}),
    };
    const deductions = await db
      .collection<UniformDeductionDocument>("employee_uniform_deductions")
      .find(filter)
      .sort({ deductionMonth: -1, createdAt: -1 })
      .toArray();
    const employeeIds = [...new Map(
      deductions.map((deduction) => [deduction.employeeId.toHexString(), deduction.employeeId]),
    ).values()];
    const outletIds = [...new Map(
      deductions.map((deduction) => [deduction.outletId.toHexString(), deduction.outletId]),
    ).values()];
    const [employees, outlets] = await Promise.all([
      employeeIds.length
        ? db.collection<EmployeeDocument>("employees")
            .find({ _id: { $in: employeeIds } })
            .toArray()
        : Promise.resolve([] as EmployeeDocument[]),
      outletIds.length
        ? db.collection<OutletDocument>("outlets")
            .find({ _id: { $in: outletIds } })
            .toArray()
        : Promise.resolve([] as OutletDocument[]),
    ]);
    const employeeById = new Map(
      employees.map((employee) => [employee._id.toHexString(), employee]),
    );
    const outletById = new Map(
      outlets.map((outlet) => [outlet._id.toHexString(), outlet]),
    );
    const rows = deductions.map((deduction) => {
      const employee = employeeById.get(deduction.employeeId.toHexString());
      const outlet = outletById.get(deduction.outletId.toHexString());
      return {
        Employee: safeText(employee?.fullName ?? "Employee"),
        "Employee ID": safeText(employee?.employeeCode ?? ""),
        Mobile: safeText(employee?.mobile ?? ""),
        Outlet: safeText(outlet?.code ?? ""),
        Item: UNIFORM_ITEM_LABELS[deduction.item],
        "Amount (INR)": deduction.amount,
        "Deduction month": deduction.deductionMonth,
        Status: deduction.status,
        Remark: safeText(deduction.remark ?? ""),
      };
    });

    if (format === "csv") {
      const headers = Object.keys(rows[0] ?? {
        Employee: "",
        "Employee ID": "",
        Mobile: "",
        Outlet: "",
        Item: "",
        "Amount (INR)": "",
        "Deduction month": "",
        Status: "",
        Remark: "",
      });
      const csvCell = (value: unknown) =>
        `"${String(value ?? "").replaceAll('"', '""')}"`;
      const csv = [
        headers.map(csvCell).join(","),
        ...rows.map((row) =>
          headers.map((header) => csvCell(row[header as keyof typeof row])).join(","),
        ),
      ].join("\r\n");
      return new NextResponse(`\uFEFF${csv}`, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="uniform-deductions.csv"',
          "Cache-Control": "no-store",
        },
      });
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Uniform deductions");
    const headers = Object.keys(rows[0] ?? {
      Employee: "",
      "Employee ID": "",
      Mobile: "",
      Outlet: "",
      Item: "",
      "Amount (INR)": "",
      "Deduction month": "",
      Status: "",
      Remark: "",
    });
    sheet.addRow(headers);
    for (const row of rows)
      sheet.addRow(headers.map((header) => row[header as keyof typeof row]));
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF254D46" },
    };
    sheet.columns = headers.map((header) => ({
      header,
      width: Math.min(
        32,
        Math.max(
          14,
          ...rows.map(
            (row) => String(row[header as keyof typeof row] ?? "").length + 2,
          ),
        ),
      ),
    }));
    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="uniform-deductions.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
