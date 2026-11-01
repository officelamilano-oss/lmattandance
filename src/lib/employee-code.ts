import type { Collection } from "mongodb";
import type { EmployeeDocument } from "@/lib/models";

export function getEmployeeCodePrefix(outletName: string) {
  return outletName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/gi, "")
    .slice(0, 3)
    .toUpperCase();
}

export async function getNextEmployeeCode(
  employees: Collection<EmployeeDocument>,
  prefix: string,
  excludeEmployeeId?: EmployeeDocument["_id"],
) {
  const rows = await employees
    .find(
      {
        employeeCode: { $regex: new RegExp(`^${prefix}\\d{4}$`, "i") },
        ...(excludeEmployeeId ? { _id: { $ne: excludeEmployeeId } } : {}),
      },
      { projection: { employeeCode: 1 } },
    )
    .toArray();
  const maximum = rows.reduce((highest, employee) => {
    const value = Number(employee.employeeCode.slice(prefix.length));
    return Number.isInteger(value) ? Math.max(highest, value) : highest;
  }, 0);
  return maximum < 9999
    ? `${prefix}${String(maximum + 1).padStart(4, "0")}`
    : null;
}
