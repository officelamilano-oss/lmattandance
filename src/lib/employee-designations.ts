export const EMPLOYEE_DESIGNATIONS = [
  { key: "OFFICE_STAFF_HO", label: "Office Staff (HO)", group: "HEAD_OFFICE" },
  { key: "PEON_HO", label: "Peon (HO)", group: "HEAD_OFFICE" },
  {
    key: "HOUSE_KEEPING_HO",
    label: "House Keeping (HO)",
    group: "HEAD_OFFICE",
  },
  {
    key: "KITCHEN_STAFF_OUTLET",
    label: "Kitchen Staff (Outlet)",
    group: "OUTLET",
  },
  { key: "CASHIER_OUTLET", label: "Cashier (Outlet)", group: "OUTLET" },
  {
    key: "DELIVERY_RIDER_OUTLET",
    label: "Delivery Rider (Outlet)",
    group: "OUTLET",
  },
  {
    key: "OUTLET_MANAGER",
    label: "Outlet Manager (Outlet)",
    group: "OUTLET",
  },
  {
    key: "HOUSE_KEEPING_OUTLET",
    label: "House Keeping (Outlet)",
    group: "OUTLET",
  },
] as const;

export type EmployeeDesignationKey =
  (typeof EMPLOYEE_DESIGNATIONS)[number]["key"];
export type EmployeeDesignationGroup =
  (typeof EMPLOYEE_DESIGNATIONS)[number]["group"];

export function getEmployeeDesignationGroup(outletCode: string) {
  return outletCode === "OUT10" ? "HEAD_OFFICE" : "OUTLET";
}

export function isEmployeeDesignationAllowed(
  designationKey: string,
  outletCode: string,
) {
  const designation = EMPLOYEE_DESIGNATIONS.find(
    (item) => item.key === designationKey,
  );
  return (
    designation !== undefined &&
    designation.group === getEmployeeDesignationGroup(outletCode)
  );
}

export function isDeliveryRiderDesignation(designation: {
  designationKey?: string | null;
  designation?: string;
}) {
  return (
    designation.designationKey === "DELIVERY_RIDER_OUTLET" ||
    (!designation.designationKey &&
      designation.designation?.trim().toLowerCase() === "delivery rider")
  );
}
