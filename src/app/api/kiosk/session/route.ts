import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { getActor, assertOutletAccess, hasPermission } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import type {
  EmployeeDocument,
  EmployeeFaceTemplateDocument,
  OutletDocument,
} from "@/lib/models";

export async function GET(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Sign in to your workspace to use the attendance kiosk." },
        { status: 401 },
      );
    if (!hasPermission(actor, "attendance.write"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const db = await getDb();
    const outlets = await db
      .collection<OutletDocument>("outlets")
      .find({
        active: true,
        ...(actor.role === "MAIN_ADMIN"
          ? {}
          : { _id: { $in: actor.outletIds } }),
      })
      .sort({ sort_order: 1, code: 1 })
      .toArray();
    const outletOptions = outlets.map((outlet) => ({
      id: outlet._id.toHexString(),
      code: outlet.code,
      name: outlet.name,
    }));

    const requestedOutlet = new URL(request.url).searchParams.get("outletId");
    if (!requestedOutlet)
      return NextResponse.json({ outlets: outletOptions });
    if (
      requestedOutlet !== "all" &&
      !/^[a-f\d]{24}$/i.test(requestedOutlet)
    )
      return NextResponse.json(
        { error: "Choose a valid outlet." },
        { status: 400 },
      );

    const selectedOutlets =
      requestedOutlet === "all"
        ? outlets
        : (() => {
            const outletId = new ObjectId(requestedOutlet);
            assertOutletAccess(actor, outletId);
            return outlets.filter((outlet) => outlet._id.equals(outletId));
          })();
    if (requestedOutlet !== "all" && !selectedOutlets.length)
      return NextResponse.json(
        { error: "Choose an active outlet you can access." },
        { status: 403 },
      );
    if (!selectedOutlets.length)
      return NextResponse.json({ outlets: outletOptions, employees: [] });

    const selectedOutletIds = selectedOutlets.map((outlet) => outlet._id);
    const faceTemplates = await db
      .collection<EmployeeFaceTemplateDocument>("employeeFaceTemplates")
      .find(
        { outletId: { $in: selectedOutletIds } },
        { projection: { employeeId: 1, outletId: 1 } },
      )
      .toArray();
    const enrolledEmployeeIds = [
      ...new Map(
        faceTemplates.map((template) => [
          template.employeeId.toHexString(),
          template.employeeId,
        ]),
      ).values(),
    ];
    const employees = enrolledEmployeeIds.length
      ? await db
          .collection<EmployeeDocument>("employees")
          .find(
            {
              _id: { $in: enrolledEmployeeIds },
              outletId: { $in: selectedOutletIds },
              active: true,
            },
            {
              projection: {
                employeeCode: 1,
                fullName: 1,
                outletId: 1,
              },
            },
          )
          .sort({ fullName: 1 })
          .toArray()
      : [];
    const outletById = new Map(
      selectedOutlets.map((outlet) => [outlet._id.toHexString(), outlet]),
    );

    return NextResponse.json({
      outlets: outletOptions,
      employees: employees.map((employee) => {
        const outlet = outletById.get(employee.outletId.toHexString());
        if (!outlet)
          throw new Error("Employee outlet was not included in kiosk scope.");
        return {
          id: employee._id.toHexString(),
          code: employee.employeeCode,
          name: employee.fullName,
          outletId: employee.outletId.toHexString(),
          outletCode: outlet.code,
          outletName: outlet.name,
        };
      }),
    });
  } catch (error) {
    return apiError(error);
  }
}
