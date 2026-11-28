import type {
  AttendanceStatus,
  EmploymentType,
  Permission,
  SalaryMethod,
  SalarySettings,
  UniformItemKey,
  UserRole,
} from "@/lib/models";
import type { PayrollCalculation } from "@/lib/payroll/calculate";
import type { UniformReportItem } from "@/lib/uniform-deductions";

export type AttendanceCounts = Record<AttendanceStatus, number>;

export interface DashboardOutlet {
  _id: string;
  id?: string;
  code: string;
  name: string;
  active: boolean;
  weekly_off_count?: number;
  sort_order?: number;
  draft_sort_order?: number;
  employeeCodeRenameCount?: number;
  address?: string;
  city?: string;
  managerName?: string;
  contactPhone?: string;
  assignedUsers?: Array<{ name: string; email: string; role: UserRole }>;
  employees?: number;
  attendance?: AttendanceCounts;
  submitted?: boolean;
}

export interface WhoIsAwayView {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  outletCode: string;
  date: string;
  status: "A" | "HD";
}

export interface DashboardAttendanceEmployee {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  designation: string;
  outletCode: string;
  status: AttendanceStatus | null;
  submitted: boolean;
}

export interface DashboardTrendDay {
  date: string;
  attendance: AttendanceCounts;
  submittedOutlets: number;
  markedEmployees: number;
  outlets: Array<{
    id: string;
    code: string;
    attendance: AttendanceCounts;
  }>;
}

export interface EmployeeView {
  _id: string;
  employeeCode: string;
  fullName: string;
  designation: string;
  employmentType?: EmploymentType;
  shiftStartTime?: string;
  shiftEndTime?: string;
  shiftDurationHours?: number;
  mobile?: string | null;
  active: boolean;
  outletId: string;
  dateOfJoining?: string;
  dateOfBirth?: string | null;
  gender?: "MALE" | "FEMALE" | null;
  designationKey?: string | null;
  designationGroup?: "HEAD_OFFICE" | "OUTLET" | null;
  beneficiaryName?: string | null;
  bankName?: string | null;
  branchName?: string | null;
  accountNumber?: string | null;
  ifscCode?: string | null;
  panNumber?: string | null;
  aadhaarNumber?: string | null;
  drivingLicenceNumber?: string | null;
  approvalStatus?: "PENDING" | "APPROVED" | "REJECTED";
  termsAccepted?: boolean;
  licencePending?: boolean;
  monthlyBaseSalary?: number;
  salaryMethod?: SalaryMethod;
  pfEnabled?: boolean;
  employeePfPercent?: number;
  employerPfPercent?: number;
  esiEnabled?: boolean;
  esiPercent?: number;
  notes?: string;
  attendanceStatus?: AttendanceStatus | null;
  punchInAt?: string | null;
  punchOutAt?: string | null;
  savedAttendanceStatus?: AttendanceStatus | null;
  outletCode?: string;
  outletName?: string;
  attendanceSubmitted?: boolean;
  attendanceEntryExists?: boolean;
  attendanceEntryUpdatedAt?: string | null;
  attendanceCorrectionCount?: number;
}

export interface AdvanceView {
  _id: string;
  employeeId: string;
  outletId: string;
  date: string;
  amount: number;
  givenBy: string;
  reference: string;
  reason?: string;
  notes?: string;
  employeeName?: string;
  employeeCode?: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  payrollRecordId?: string;
  editCount?: number;
  updatedAt?: string;
}

export interface LoanView {
  _id: string;
  employeeId: string;
  outletId: string;
  totalAmount: number;
  outstandingAmount: number;
  monthlyDeductionAmount?: number;
  deductionStartMonth?: string;
  repaymentMethod?: "FIXED_AMOUNT" | "FIXED_INSTALLMENTS" | "DATE_RANGE";
  installmentCount?: number;
  deductionEndMonth?: string;
  repaidAmount?: number;
  status?: "ACTIVE" | "PAUSED" | "COMPLETED";
  completedAt?: string;
  completionReason?: string;
  completionAmount?: number;
  currentPayrollMonth?: string;
  currentInstallmentStatus?:
    | "SCHEDULED"
    | "POSTED"
    | "SKIPPED"
    | "REVERSED"
    | "PAUSED"
    | "COMPLETED"
    | "NOT_DUE";
  currentScheduledDeduction?: number;
  currentActualDeduction?: number;
  notes: string;
  employeeName?: string;
  employeeCode?: string;
  outletCode?: string;
}

export interface SalaryView {
  _id: string;
  employeeId: string;
  outletId: string;
  month: string;
  periodStart?: string;
  periodEnd?: string;
  status: "DRAFT" | "APPROVED" | "PAID";
  inputSnapshot: {
    employee: {
      fullName: string;
      employeeCode: string;
      monthlyBaseSalary?: number;
    };
    loans?: Array<{
      loanId: string;
      originalAmount: number;
      openingBalance: number;
      scheduledDeduction: number;
      actualDeduction: number;
      closingBalance: number;
      status: string;
      payrollMonth?: string;
    }>;
    uniformDeductions?: Array<{
      id?: string;
      item: UniformItemKey;
      amount: number;
      deductionMonth: string;
      remark?: string;
    }>;
  };
  calculation: PayrollCalculation;
  paidAt?: string;
  updatedAt?: string;
  loanOptions?: LoanView[];
}

export interface PayrollEmployeeView {
  _id: string;
  outletId: string;
  outletCode: string;
  fullName: string;
  employeeCode: string;
  designation: string;
  mobile?: string | null;
  monthlyBaseSalary: number;
  attendance: AttendanceCounts;
  payrollRecordId?: string;
  latestPayrollRecordId?: string;
  nextPeriodStart?: string;
  suggestedPeriodEnd?: string;
  liveNotMarkedDays?: number;
  estimatedCalculation?: PayrollCalculation;
  estimatedNetPayable?: number;
  estimatedUniformDeduction?: number;
  approvedAdvanceTotal: number;
  outstandingLoanTotal: number;
  hasLegacyPayroll: boolean;
}

export interface UserView {
  _id: string;
  email: string;
  name: string;
  role: UserRole;
  outletIds: string[];
  permissions: Permission[];
  permissionsCustomized?: boolean;
  designationId?: string;
  designationName?: string;
  active: boolean;
}

export interface DesignationView {
  _id: string;
  name: string;
  description: string;
  color: string;
  permissions: Permission[];
  assignedCount?: number;
}

export interface AuditView {
  _id: string;
  at: string;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel?: string;
  reason?: string;
  changes?: Record<string, { before: unknown; after: unknown }>;
}

export interface EmployeeAttendanceReportRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  designation: string;
  outletCode: string;
  outletName: string;
  monthlyBaseSalary?: number;
  payableAmount?: number;
  payableLabel?: string;
  grossEarnings?: number;
  notMarkedDays?: number;
  allowedWeekOff?: number;
  totalEquivalentDays?: number;
  chargeableDays?: number;
  attendanceDeduction?: number;
  notMarkedDeduction?: number;
  allowanceConsumed?: number;
  advances?: number;
  advanceDetails?: Array<{ date: string; amount: number }>;
  totalAdvances?: number;
  esi?: number;
  employeePf?: number;
  employerPf?: number;
  loanDeduction?: number;
  originalLoanAmount?: number;
  remainingLoanBalance?: number;
  monthlyLoanDeduction?: number;
  uniformDeductionsByItem?: Record<string, number>;
  totalUniformDeduction?: number;
  remainingUniformBalance?: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  weekOffs: number;
  filledDays: number;
  missingDays: number;
  unsubmittedDays: number;
  statusDates: Record<AttendanceStatus, string[]>;
  missingDates: string[];
  unsubmittedDates: string[];
  reportStart: string | null;
  reportEnd: string | null;
}

export interface EmployeeAttendanceReport {
  from: string;
  to: string;
  employees: Array<{
    id: string;
    code: string;
    name: string;
    outletId: string;
  }>;
  rows: EmployeeAttendanceReportRow[];
  uniformItems: UniformReportItem[];
  canReadSalary: boolean;
}

export interface WorkspaceData {
  today?: string;
  month?: string;
  metrics?: {
    activeEmployees?: number;
    fullTimeEmployees?: number;
    partTimeEmployees?: number;
    activeOutlets?: number;
    attendance?: AttendanceCounts;
    periodAttendance?: AttendanceCounts;
    attendanceRateChange?: number | null;
    lowestOutletCode?: string | null;
    lowestOutletRate?: number | null;
    bestOutletCode?: string | null;
    bestOutletRate?: number | null;
    unmarkedAttendanceEmployees?: number;
    missingSubmissions?: number;
    submittedOutlets?: number;
    payrollCount?: number | null;
    pendingPayroll?: number | null;
    pendingApprovals?: number;
    pendingAdvanceApprovals?: number;
    grossSalary?: number | null;
    netPayable?: number | null;
    projectedMonthEndBase?: number | null;
    approvedAdvancesPendingPayroll?: number | null;
    recordedLoanDeductions?: number | null;
    liveLoanDeductions?: number | null;
    recordedPayrollGross?: number | null;
    recordedPayrollNet?: number | null;
  };
  outlets?: DashboardOutlet[];
  attendanceEmployees?: DashboardAttendanceEmployee[];
  dashboardNotifications?: DashboardAttendanceEmployee[];
  attendanceTrend?: DashboardTrendDay[];
  whoIsAway?: WhoIsAwayView[];
  employeeAttendance?: EmployeeAttendanceReport;
  outlet?: { id: string; code: string; name: string };
  day?: {
    status?: "DRAFT" | "SUBMITTED";
    submittedAt?: string;
    updatedAt?: string;
    corrections?: Array<{
      reason: string;
      action: "UNLOCK" | "RELOCK";
      at: string;
    }>;
  };
  counts?: AttendanceCounts;
  outletCount?: number;
  submittedCount?: number;
  employees?: EmployeeView[];
  advances?: AdvanceView[];
  loans?: LoanView[];
  pendingCount?: number;
  records?: SalaryView[];
  payrollEmployees?: PayrollEmployeeView[];
  users?: UserView[];
  designations?: DesignationView[];
  logs?: AuditView[];
  hasMore?: boolean;
  total?: number;
  page?: number;
  pageSize?: number;
  settings?: Partial<SalarySettings>;
}
