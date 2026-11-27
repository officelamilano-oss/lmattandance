import type { ObjectId } from "mongodb";

export type UserRole = "MAIN_ADMIN" | "CO_ADMIN" | "OUTLET_USER";
export type Permission =
  | "dashboard.read" | "outlets.manage" | "employees.read" | "employees.create" | "employees.update"
  | "employees.deactivate" | "attendance.read" | "attendance.write" | "attendance.submit"
  | "attendance.unlock" | "advances.read" | "advances.write" | "salary.read" | "salary.generate"
  | "advances.approve" | "salary.adjust" | "salary.approve" | "salary.pay" | "settings.manage" | "access.manage"
  | "reports.export" | "audit.read" | "uniforms.manage" | "about.read"
  | "employees.shift.manage" | "employees.face.manage";

export interface UserDocument {
  _id: ObjectId;
  email: string;
  emailNormalized: string;
  username?: string;
  usernameNormalized?: string;
  name: string;
  passwordHash?: string;
  image?: string;
  role: UserRole;
  outletIds: ObjectId[];
  permissions: Permission[];
  permissionsCustomized?: boolean;
  designationId?: ObjectId;
  designationName?: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DesignationDocument {
  _id: ObjectId;
  name: string;
  nameNormalized: string;
  description: string;
  color: string;
  permissions: Permission[];
  createdAt: Date;
  updatedAt: Date;
}

export interface OutletDocument {
  _id: ObjectId;
  code: string;
  name: string;
  address: string;
  city: string;
  managerName: string;
  contactPhone: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type SalaryMethod =
  | "FIXED_30_DAYS"
  | "CALENDAR_DAYS"
  | "WORKING_DAYS_26";
export type EmploymentType = "FULL_TIME" | "PART_TIME";
export interface EmployeeDocument {
  _id: ObjectId;
  employeeCode: string;
  employeeCodeNormalized: string;
  fullName: string;
  dateOfJoining: string;
  dateOfBirth?: string | null;
  gender?: "MALE" | "FEMALE" | null;
  designation: string;
  designationKey?: string | null;
  designationGroup?: "HEAD_OFFICE" | "OUTLET" | null;
  employmentType?: EmploymentType;
  shiftStartTime?: string;
  shiftEndTime?: string;
  mobile?: string | null;
  outletId: ObjectId;
  monthlyBaseSalary: number;
  salaryMethod: SalaryMethod;
  pfEnabled: boolean;
  employeePfPercent: number;
  employerPfPercent: number;
  esiEnabled?: boolean;
  esiPercent?: number;
  beneficiaryName?: string | null;
  bankName?: string | null;
  branchName?: string | null;
  accountNumber?: string | null;
  ifscCode?: string | null;
  panNumber?: string | null;
  aadhaarNumber?: string | null;
  drivingLicenceNumber?: string | null;
  approvalStatus?: "PENDING" | "APPROVED" | "REJECTED";
  approvalRequestedAt?: Date;
  approvedAt?: Date;
  approvedBy?: ObjectId;
  rejectedAt?: Date;
  rejectedBy?: ObjectId;
  termsAccepted?: boolean;
  termsVersion?: string;
  acceptedAt?: Date;
  acceptedBy?: ObjectId;
  active: boolean;
  deactivatedAt?: string;
  notes?: string;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type EmployeeDocumentType =
  | "AADHAAR"
  | "PAN"
  | "BANK_PROOF"
  | "DRIVING_LICENCE"
  | "PHOTO"
  | "SIGNATURE"
  | "OTHER";

export interface EmployeeFileDocument {
  _id: ObjectId;
  employeeId: ObjectId;
  outletId?: ObjectId;
  provider?: "imagekit" | "cloudinary" | "s3" | "local" | "mongodb";
  fileId?: string;
  filePath?: string;
  fileName?: string;
  fileType?: string;
  documentType: EmployeeDocumentType;
  storageKey?: string;
  mimeType?: string;
  size: number;
  uploadedBy: ObjectId;
  uploadedAt?: Date;
  createdAt?: Date;
}

export type AttendanceStatus = "P" | "A" | "WO" | "HD";
export interface AttendanceEntry { employeeId: ObjectId; status: AttendanceStatus; updatedAt: Date; updatedBy: ObjectId; correctionCount?: number; submitted?: boolean }
export interface AttendanceDayDocument {
  _id: ObjectId;
  outletId: ObjectId;
  date: string;
  entries: AttendanceEntry[];
  status: "DRAFT" | "SUBMITTED";
  submittedAt?: Date;
  submittedBy?: ObjectId;
  employeeCorrectionCounts?: Array<{
    employeeId: ObjectId;
    correctionCount: number;
  }>;
  corrections: Array<{ at: Date; actorId: ObjectId; reason: string; action: "UNLOCK" | "RELOCK" }>;
  updatedAt: Date;
  updatedBy: ObjectId;
}

export interface EmployeeFaceTemplateDocument {
  _id: ObjectId;
  employeeId: ObjectId;
  outletId: ObjectId;
  encryptedDescriptor: {
    iv: string;
    authTag: string;
    ciphertext: string;
  };
  consentAt: Date;
  consentBy: ObjectId;
  consentVersion: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface KioskDeviceDocument {
  _id: ObjectId;
  outletId: ObjectId;
  label: string;
  tokenHash?: string;
  pinHash?: string;
  pinEncrypted?: {
    iv: string;
    authTag: string;
    ciphertext: string;
  };
  active: boolean;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date;
}

export interface AttendancePunchDocument {
  _id: ObjectId;
  employeeId: ObjectId;
  outletId: ObjectId;
  date: string;
  checkInAt?: Date;
  checkOutAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdvanceDocument {
  _id: ObjectId;
  employeeId: ObjectId;
  outletId: ObjectId;
  date: string;
  approvedDate?: string;
  amount: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  editCount?: number;
  givenBy: string;
  reference: string;
  reason?: string;
  notes?: string;
  payrollRecordId?: ObjectId;
  createdBy: ObjectId;
  updatedBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type UniformItemKey =
  | "shirt"
  | "pant"
  | "shoes"
  | "cap"
  | "costume";

export type UniformDeductionStatus = "SCHEDULED" | "APPLIED" | "CANCELLED";

export interface UniformDeductionDocument {
  _id: ObjectId;
  employeeId: ObjectId;
  outletId: ObjectId;
  item: UniformItemKey;
  amount: number;
  deductionMonth: string;
  status: UniformDeductionStatus;
  remark?: string;
  payrollRecordId?: ObjectId;
  createdBy: ObjectId;
  updatedBy: ObjectId;
  appliedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UniformItemDocument {
  _id: UniformItemKey;
  label: string;
  defaultAmount: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoanDocument {
  _id: ObjectId;
  employeeId: ObjectId;
  outletId: ObjectId;
  totalAmount: number;
  outstandingAmount: number;
  monthlyDeductionAmount?: number;
  deductionStartMonth?: string;
  resumeEffectiveMonth?: string;
  repaymentMethod?: "FIXED_AMOUNT" | "FIXED_INSTALLMENTS" | "DATE_RANGE";
  installmentCount?: number;
  deductionEndMonth?: string;
  repaidAmount?: number;
  status?: "ACTIVE" | "PAUSED" | "COMPLETED";
  statusReason?: string;
  statusUpdatedAt?: Date;
  statusUpdatedBy?: ObjectId;
  statusHistory?: Array<{
    status: "ACTIVE" | "PAUSED" | "COMPLETED";
    effectiveAt: Date;
    effectivePayrollMonth?: string;
    actorId: ObjectId;
    reason?: string;
  }>;
  completedAt?: Date;
  completionReason?: string;
  completionReference?: string;
  completionAmount?: number;
  completedBy?: ObjectId;
  repaymentTermsHistory?: Array<{
    method: "FIXED_AMOUNT" | "FIXED_INSTALLMENTS" | "DATE_RANGE";
    monthlyDeductionAmount: number;
    deductionStartMonth: string;
    installmentCount: number;
    deductionEndMonth: string;
    effectiveAt: Date;
    actorId: ObjectId;
  }>;
  notes: string;
  createdBy: ObjectId;
  updatedBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type LoanInstallmentStatus =
  | "SCHEDULED"
  | "POSTED"
  | "SKIPPED"
  | "REVERSED";

export interface LoanInstallmentDocument {
  _id: ObjectId;
  loanId: ObjectId;
  employeeId: ObjectId;
  outletId: ObjectId;
  payrollMonth: string;
  openingBalance: number;
  scheduledDeduction: number;
  actualDeduction: number;
  closingBalance: number;
  status: LoanInstallmentStatus;
  skipReason?: string;
  payrollRecordId?: ObjectId;
  actorId: ObjectId;
  reversalReason?: string;
  reversedBy?: ObjectId;
  reversedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoanTransactionDocument {
  _id: ObjectId;
  loanId: ObjectId;
  employeeId: ObjectId;
  outletId: ObjectId;
  type:
    | "BALANCE_ADJUSTMENT"
    | "EXTERNAL_SETTLEMENT"
    | "WRITE_OFF"
    | "OTHER_CLOSURE"
    | "REVERSAL";
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  reason: string;
  reference?: string;
  transactionDate: string;
  actorId: ObjectId;
  createdAt: Date;
}

export interface SalarySettings {
  timezone: string;
  defaultSalaryMethod: SalaryMethod;
  workingDaysDivisor: number;
  paidAbsences: number;
  countTodayAsNotMarked?: boolean;
  declaredOffDays?: string[];
  currency: "INR";
  advanceDeductionPolicy: "UNPAID_ONLY";
}

export interface SalaryRecordDocument {
  _id: ObjectId;
  employeeId: ObjectId;
  outletId: ObjectId;
  month: string;
  periodStart?: string;
  periodEnd?: string;
  status: "DRAFT" | "APPROVED" | "PAID";
  inputSnapshot: Record<string, unknown> & {
    employee: {
      [key: string]: unknown;
      fullName: string;
      employeeCode: string;
      monthlyBaseSalary?: number;
    };
    uniformDeductions?: Array<{
      id?: ObjectId;
      item: UniformItemKey;
      amount: number;
      deductionMonth: string;
      remark?: string;
    }>;
  };
  calculation: Record<string, number | string>;
  adjustments: Array<{ label: string; amount: number; reason: string; actorId: ObjectId; at: Date }>;
  approvedBy?: ObjectId;
  approvedAt?: Date;
  paidBy?: ObjectId;
  paidAt?: Date;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLogDocument {
  _id: ObjectId;
  actorId: ObjectId;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  outletId?: ObjectId;
  at: Date;
  reason?: string;
  changes?: Record<string, { before: unknown; after: unknown }>;
}

export interface LoginAttemptDocument {
  _id: string;
  attempts: number;
  windowStartedAt: Date;
  blockedUntil?: Date;
  expiresAt: Date;
}