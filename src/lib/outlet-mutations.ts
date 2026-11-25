import { ObjectId } from "mongodb";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { getDb, getMongoClient } from "@/lib/mongodb";
import type { EmployeeDocument } from "@/lib/models";
import { getEmployeeCodePrefix } from "@/lib/employee-code";
import type { OutletSettingsDocument } from "@/lib/outlet-settings";
import { outletSchema } from "@/lib/validation/business";

const outletPatchSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(100).optional(),
  managerName: z.string().trim().max(120).optional(),
  contactPhone: z.string().trim().max(20).optional(),
  active: z.boolean().optional(),
  weekly_off_count: z.number().int().min(0).max(7).optional(),
  confirmEmployeeCodeUpdateCount: z.number().int().min(0).optional(),
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function updateOutletDocument(
  outletId: ObjectId,
  payload: unknown,
  actor: { id: ObjectId; email: string },
): Promise<{ confirmationRequiredCount?: number }> {
  const input = outletPatchSchema.parse(payload);
  const {
    confirmEmployeeCodeUpdateCount,
    ...fields
  } = input;
  const db = await getDb();
  const session = (await getMongoClient()).startSession();
  let result: { confirmationRequiredCount?: number } = {};

  try {
    await session.withTransaction(async () => {
      const outlets = db.collection<
        OutletSettingsDocument & { outletCode?: string; outlet_code?: string }
      >("outlets");
      const before = await outlets.findOne({ _id: outletId }, { session });
      if (!before) throw new Error("NOT_FOUND");
      const code = before.code ?? before.outletCode ?? before.outlet_code;
      if (!code) throw new Error("OUTLET_CODE_REQUIRED");
      const parsed = outletSchema.parse({
        code,
        name: fields.name ?? before.name ?? code,
        address: fields.address ?? before.address ?? "",
        city: fields.city ?? before.city ?? "",
        managerName: fields.managerName ?? before.managerName ?? "",
        contactPhone: fields.contactPhone ?? before.contactPhone ?? "",
        active: fields.active ?? before.active ?? false,
        weekly_off_count:
          fields.weekly_off_count ?? before.weekly_off_count ?? 3,
      });
      const previousPrefix = getEmployeeCodePrefix(before.name ?? code);
      const nextPrefix = getEmployeeCodePrefix(parsed.name);
      const employees = db.collection<EmployeeDocument>("employees");
      const prefixChanged = previousPrefix !== nextPrefix;
      const matchingEmployees = prefixChanged
        ? await employees
            .find(
              {
                outletId,
                employeeCode: {
                  $regex: new RegExp(
                    `^${escapeRegExp(previousPrefix)}\\d{4}$`,
                    "i",
                  ),
                },
              },
              { session, projection: { employeeCode: 1 } },
            )
            .toArray()
        : [];

      if (
        matchingEmployees.length > 0 &&
        confirmEmployeeCodeUpdateCount !== matchingEmployees.length
      ) {
        result = { confirmationRequiredCount: matchingEmployees.length };
        return;
      }

      const renamedCodes = matchingEmployees.map((employee) => ({
        employee,
        code: `${nextPrefix}${employee.employeeCode.slice(previousPrefix.length)}`.toUpperCase(),
      }));
      const newCodes = renamedCodes.map(({ code: employeeCode }) => employeeCode);
      if (new Set(newCodes).size !== newCodes.length)
        throw new Error("EMPLOYEE_CODE_CONFLICT");
      if (newCodes.length) {
        const matchingIds = matchingEmployees.map((employee) => employee._id);
        const conflictingEmployee = await employees.findOne(
          {
            _id: { $nin: matchingIds },
            $or: [
              { employeeCodeNormalized: { $in: newCodes } },
              {
                employeeCode: {
                  $in: newCodes.map(
                    (employeeCode) =>
                      new RegExp(`^${escapeRegExp(employeeCode)}$`, "i"),
                  ),
                },
              },
            ],
          },
          { session, projection: { _id: 1 } },
        );
        if (conflictingEmployee)
          throw new Error("EMPLOYEE_CODE_CONFLICT");
        const now = new Date();
        await employees.bulkWrite(
          renamedCodes.map(({ employee, code: employeeCode }) => ({
            updateOne: {
              filter: { _id: employee._id },
              update: {
                $set: {
                  employeeCode,
                  employeeCodeNormalized: employeeCode,
                  updatedAt: now,
                },
              },
            },
          })),
          { session, ordered: true },
        );
      }

      const now = new Date();
      await outlets.updateOne(
        { _id: outletId },
        { $set: { ...parsed, updatedAt: now } },
        { session },
      );
      await writeAudit(
        {
          actorId: actor.id,
          actorEmail: actor.email,
          action: "OUTLET_UPDATED",
          entityType: "outlet",
          entityId: outletId.toHexString(),
          outletId,
          changes: {
            name: { before: before.name, after: parsed.name },
            address: { before: before.address, after: parsed.address },
            city: { before: before.city, after: parsed.city },
            managerName: {
              before: before.managerName,
              after: parsed.managerName,
            },
            contactPhone: {
              before: before.contactPhone,
              after: parsed.contactPhone,
            },
            active: { before: before.active, after: parsed.active },
            weekly_off_count: {
              before: before.weekly_off_count ?? 3,
              after: parsed.weekly_off_count,
            },
            employeeCodesUpdated: {
              before: 0,
              after: renamedCodes.length,
            },
          },
        },
        session,
      );
      result = {};
    });
    return result;
  } finally {
    await session.endSession();
  }
}
