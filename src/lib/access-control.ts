import type { Permission } from "@/lib/models";

export const designationPermissionGroups: Array<{
  title: string;
  permissions: Array<{ value: Permission; label: string }>;
}> = [
  {
    title: "Dashboard",
    permissions: [{ value: "dashboard.read", label: "View dashboard" }],
  },
  {
    title: "Attendance",
    permissions: [
      { value: "attendance.read", label: "View attendance" },
      { value: "attendance.write", label: "Mark attendance" },
      { value: "attendance.submit", label: "Submit and lock attendance" },
      { value: "attendance.unlock", label: "Unlock submitted attendance" },
    ],
  },
  {
    title: "Employees",
    permissions: [
      { value: "employees.read", label: "View employees" },
      { value: "employees.create", label: "Add employees" },
      { value: "employees.update", label: "Edit employees" },
      { value: "employees.deactivate", label: "Deactivate employees" },
      { value: "employees.shift.manage", label: "Manage employee shifts" },
      { value: "employees.face.manage", label: "Manage face enrollment" },
    ],
  },
  {
    title: "Advances",
    permissions: [
      { value: "advances.read", label: "View advances" },
      { value: "advances.write", label: "Record advances" },
      { value: "advances.approve", label: "Approve advances" },
    ],
  },
  {
    title: "Monthly salary",
    permissions: [
      { value: "salary.read", label: "View salary and payroll" },
      { value: "salary.generate", label: "Generate payroll" },
      { value: "salary.adjust", label: "Adjust payroll" },
      { value: "salary.approve", label: "Approve payroll" },
      { value: "salary.pay", label: "Mark payroll as paid" },
    ],
  },
  {
    title: "Uniform deductions",
    permissions: [
      { value: "uniforms.manage", label: "Manage uniform deductions" },
    ],
  },
  {
    title: "Reports",
    permissions: [{ value: "reports.export", label: "View and export reports" }],
  },
  {
    title: "About Us",
    permissions: [{ value: "about.read", label: "View About Us" }],
  },
  {
    title: "Face attendance",
    permissions: [
      { value: "attendance.write", label: "Use Face Attendance Kiosk" },
      { value: "employees.read", label: "View Face Attendance Reports" },
    ],
  },
  {
    title: "Loans",
    permissions: [{ value: "salary.read", label: "View loans" }],
  },
  {
    title: "Outlets",
    permissions: [{ value: "outlets.manage", label: "Manage outlets" }],
  },
  {
    title: "User management",
    permissions: [{ value: "access.manage", label: "Manage users and designations" }],
  },
  {
    title: "Active logs",
    permissions: [{ value: "audit.read", label: "View active logs" }],
  },
  {
    title: "Settings",
    permissions: [{ value: "settings.manage", label: "Manage settings" }],
  },
];

export const designationOnlyPermissionSet = new Set<Permission>(["about.read"]);

export const mainAdminPermissionValues = [
  "outlets.manage",
  "access.manage",
  "settings.manage",
  "audit.read",
] as const satisfies readonly [Permission, ...Permission[]];

export const allPermissionValues = Array.from(
  new Set<Permission>([
    ...designationPermissionGroups.flatMap((group) =>
      group.permissions.map((permission) => permission.value),
    ),
    ...mainAdminPermissionValues,
  ]),
) as [Permission, ...Permission[]];

export const staffPermissionValues = allPermissionValues;
export const staffPermissionSet = new Set<Permission>(staffPermissionValues);

export const legacyOutletDefaultPermissions: Permission[] = [
  "dashboard.read",
  "attendance.read",
  "attendance.write",
  "attendance.submit",
];

export const adminOnlyPages = [
  { title: "Loans" },
  { title: "Active logs" },
  { title: "Outlets", permission: "outlets.manage" },
  { title: "Access management", permission: "access.manage" },
  { title: "Settings", permission: "settings.manage" },
] as const;
