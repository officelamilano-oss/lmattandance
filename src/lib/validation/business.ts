import { z } from "zod";
import { dateOnlySchema, objectIdSchema } from "./common";
import {
  staffPermissionSet,
  staffPermissionValues,
} from "@/lib/access-control";

export const employeeSchema = z.object({
  employeeCode: z.string().trim().min(1).max(30),
  fullName: z.string().trim().min(2).max(120),
  dateOfJoining: dateOnlySchema,
  dateOfBirth: dateOnlySchema.nullable().optional(),
  gender: z.enum(["MALE", "FEMALE"]).nullable().optional(),
  designation: z.string().trim().min(1).max(80),
  designationKey: z.string().trim().max(80).nullable().optional(),
  designationGroup: z.enum(["HEAD_OFFICE", "OUTLET"]).nullable().optional(),
  employmentType: z.enum(["FULL_TIME", "PART_TIME"]).default("FULL_TIME"),
  mobile: z.string().trim().min(7).max(20),
  outletId: objectIdSchema,
  monthlyBaseSalary: z.number().finite().min(0).max(100_000_000),
  salaryMethod: z.enum(["FIXED_30_DAYS", "CALENDAR_DAYS", "WORKING_DAYS_26"]),
  pfEnabled: z.boolean(),
  employeePfPercent: z.number().min(0).max(100),
  employerPfPercent: z.number().min(0).max(100),
  esiEnabled: z.boolean().optional().default(false),
  esiPercent: z.number().min(0).max(100).optional().default(0.75),
  notes: z.string().trim().max(1000).optional().default(""),
  beneficiaryName: z.string().trim().max(120).nullable().optional(),
  bankName: z.string().trim().max(120).nullable().optional(),
  branchName: z.string().trim().max(120).nullable().optional(),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{9,18}$/, "Account number must contain 9 to 18 digits.")
    .nullable()
    .optional(),
  ifscCode: z
    .string()
    .trim()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid IFSC code.")
    .nullable()
    .optional(),
  panNumber: z
    .string()
    .trim()
    .regex(/^[A-Z]{5}\d{4}[A-Z]$/, "Enter PAN in the format AAAAA9999A.")
    .nullable()
    .optional(),
  aadhaarNumber: z
    .string()
    .trim()
    .regex(/^\d{12}$/, "Aadhaar number must contain exactly 12 digits.")
    .nullable()
    .optional(),
  drivingLicenceNumber: z.string().trim().max(40).nullable().optional(),
  termsAccepted: z.literal(true).optional(),
  termsVersion: z.string().trim().max(20).optional(),
  acceptedAt: z.date().optional(),
  acceptedBy: objectIdSchema.optional(),
}).superRefine((employee, context) => {
  if (!employee.dateOfBirth) return;
  if (employee.dateOfBirth >= employee.dateOfJoining) {
    context.addIssue({
      code: "custom",
      path: ["dateOfBirth"],
      message: "Date of birth must be before the joining date.",
    });
    return;
  }
  const [birthYear, birthMonth, birthDay] = employee.dateOfBirth
    .split("-")
    .map(Number);
  const [joinYear, joinMonth, joinDay] = employee.dateOfJoining
    .split("-")
    .map(Number);
  let age = joinYear - birthYear;
  if (
    joinMonth < birthMonth ||
    (joinMonth === birthMonth && joinDay < birthDay)
  )
    age -= 1;
  if (age < 18)
    context.addIssue({
      code: "custom",
      path: ["dateOfBirth"],
      message: "Employee must be at least 18 on the joining date.",
    });
});

export const attendanceSchema = z.object({
  outletId: objectIdSchema,
  date: dateOnlySchema,
  entries: z
    .array(
      z.object({
        employeeId: objectIdSchema,
        status: z.enum(["P", "A", "WO", "HD"]).nullable(),
      }),
    )
    .max(500),
});

export const advanceSchema = z.object({
  employeeId: objectIdSchema,
  outletId: objectIdSchema,
  date: dateOnlySchema,
  amount: z.number().finite().positive().max(10_000_000),
  givenBy: z.string().trim().min(2).max(120),
  reference: z.string().trim().min(2).max(200),
  notes: z.string().trim().max(1000).optional().default(""),
});

export const loanSchema = z.object({
  employeeId: objectIdSchema,
  outletId: objectIdSchema,
  totalAmount: z.number().finite().positive().max(10_000_000),
  outstandingAmount: z.number().finite().nonnegative().max(10_000_000),
  notes: z.string().trim().max(1000).default(""),
}).refine((loan) => loan.outstandingAmount <= loan.totalAmount, {
  message: "Outstanding amount cannot exceed the original loan.",
  path: ["outstandingAmount"],
});

export const outletSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^OUT\d{2}$/),
  name: z.string().trim().min(2).max(100),
  address: z.string().trim().max(300).default(""),
  city: z.string().trim().max(100).default(""),
  managerName: z.string().trim().max(120).default(""),
  contactPhone: z.string().trim().max(20).default(""),
  active: z.boolean().default(false),
});

const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters.")
  .max(72, "Password is too long.")
  .refine((password) => new TextEncoder().encode(password).length <= 72, "Password is too long.");

export const userProvisionSchema = z
  .object({
    email: z.string().trim().email().max(254),
    name: z.string().trim().min(2).max(120),
    password: passwordSchema.optional(),
    role: z.enum(["MAIN_ADMIN", "CO_ADMIN", "OUTLET_USER"]),
    outletIds: z.array(objectIdSchema).max(100).default([]),
    designationId: objectIdSchema.optional(),
    permissions: z
      .array(
        z.enum([
          "dashboard.read",
          "outlets.manage",
          "employees.read",
          "employees.create",
          "employees.update",
          "employees.deactivate",
          "attendance.read",
          "attendance.write",
          "attendance.submit",
          "attendance.unlock",
          "advances.read",
          "advances.write",
          "advances.approve",
          "salary.read",
          "salary.generate",
          "salary.adjust",
          "salary.approve",
          "salary.pay",
          "settings.manage",
          "access.manage",
          "reports.export",
          "audit.read",
        ]),
      )
      .max(30)
      .default([]),
    active: z.boolean(),
  })
  .superRefine((input, context) => {
    if (input.role !== "MAIN_ADMIN") {
      for (const permission of input.permissions) {
        if (!staffPermissionSet.has(permission))
          context.addIssue({
            code: "custom",
            path: ["permissions"],
            message: `${permission} is restricted to MAIN_ADMIN.`,
          });
      }
    }
    if (input.role === "MAIN_ADMIN" && input.designationId)
      context.addIssue({
        code: "custom",
        path: ["designationId"],
        message: "MAIN_ADMIN accounts cannot use a designation template.",
      });
  });

export const designationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(240).default(""),
  color: z
    .enum(["#635bdb", "#201f58", "#ef43b4", "#e91e63", "#a46526", "#3b82f6"])
    .default("#635bdb"),
  permissions: z
    .array(z.enum(staffPermissionValues))
    .max(20)
    .refine(
      (permissions) => new Set(permissions).size === permissions.length,
      "Permissions must not contain duplicates.",
    ),
});
