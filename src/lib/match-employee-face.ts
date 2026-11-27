import { ObjectId, type Db } from "mongodb";
import type {
  EmployeeDocument,
  EmployeeFaceTemplateDocument,
} from "@/lib/models";
import {
  compareFaceDescriptors,
  decryptFaceDescriptor,
  FACE_MATCH_THRESHOLD,
} from "@/lib/face-templates";

export async function matchEmployeeFace(
  db: Db,
  outletId: ObjectId,
  descriptor: number[],
) {
  const employees = await db
    .collection<EmployeeDocument>("employees")
    .find(
      { outletId, active: true },
      {
        projection: {
          _id: 1,
          employeeCode: 1,
          fullName: 1,
          shiftStartTime: 1,
          shiftEndTime: 1,
        },
      },
    )
    .toArray();
  if (!employees.length) return null;
  const employeeById = new Map(
    employees.map((employee) => [employee._id.toHexString(), employee]),
  );
  const templates = await db
    .collection<EmployeeFaceTemplateDocument>("employeeFaceTemplates")
    .find({
      outletId,
      employeeId: { $in: employees.map((employee) => employee._id) },
    })
    .toArray();
  const candidates = templates
    .map((template) => {
      const employee = employeeById.get(template.employeeId.toHexString());
      if (!employee) return null;
      return {
        employee,
        distance: compareFaceDescriptors(
          descriptor,
          decryptFaceDescriptor(template.encryptedDescriptor),
        ),
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> =>
      candidate !== null,
    )
    .sort((first, second) => first.distance - second.distance);
  const best = candidates[0];
  if (
    !best ||
    best.distance > FACE_MATCH_THRESHOLD ||
    (candidates[1] && candidates[1].distance - best.distance < 0.04)
  )
    return null;
  return best.employee;
}
