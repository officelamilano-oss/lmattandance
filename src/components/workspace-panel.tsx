  "use client";

  import {
    useEffect,
    useEffectEvent,
    useRef,
    useState,
    useSyncExternalStore,
    Fragment,
    type FormEvent,
    type ReactNode,
  } from "react";
  import Link from "next/link";
  import Image from "next/image";
  import { createPortal } from "react-dom";
  import {
    ArrowDownToLine,
    ArrowUpRight,
    Bell,
    Banknote,
    Building2,
    BriefcaseBusiness,
    CalendarDays,
    CalendarClock,
    Check,
    CircleCheck,
    ChevronLeft,
    ChevronRight,
    Clock3,
    Eye,
    EyeOff,
    FileSpreadsheet,
    FileText,
    Info,
    HandCoins,
    LoaderCircle,
    Plus,
    RefreshCw,
    Search,
    Send,
    SlidersHorizontal,
    Users,
    X,
  } from "lucide-react";
  import type {
    AttendanceStatus,
    Permission,
    SalarySettings,
    UserRole,
  } from "@/lib/models";
  import type {
    AttendanceCounts,
    DashboardOutlet,
    DesignationView,
    EmployeeView,
    EmployeeAttendanceReportRow,
    LoanView,
    PayrollEmployeeView,
    SalaryView,
    UserView,
    WhoIsAwayView,
    WorkspaceData,
  } from "@/lib/ui-types";
  import {
    adminOnlyPages,
    designationPermissionGroups,
    legacyOutletDefaultPermissions,
  } from "@/lib/access-control";
  import { useEmployeeAttendanceReport } from "@/lib/use-employee-attendance-report";
  import { EmployeeImportPanel } from "@/components/employee-import-panel";
  import { EmployeeCreatePanel } from "@/components/employee-create-panel";
  import { AutoDismissNotice } from "@/components/auto-dismiss-notice";
  import { LazySection } from "@/components/lazy-section";
  import { DashboardPartLoader } from "@/components/dashboard-part-loader";
  import { getIndiaDate, getIndiaMonth } from "@/lib/payroll/dates";
  import { isAttendanceEntryLocked } from "@/lib/attendance";
  import { calculateLoanInstallment } from "@/lib/payroll/calculate";
  import {
    expectedCompletionMonth,
    loanScheduleSummary,
  } from "@/lib/payroll/loans";
  import { formatDate, formatDateTime } from "@/lib/date-format";
  import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Legend,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
  } from "recharts";

  type Section =
    | "dashboard"
    | "attendance"
    | "salary"
    | "employees"
    | "advances"
    | "loans"
    | "outlets"
    | "access"
    | "reports"
    | "activeLogs"
    | "settings";
  type Outlet = DashboardOutlet;
  type Employee = EmployeeView;
  type LoanActionName =
    | "SKIP"
    | "PAUSE"
    | "RESUME"
    | "CLOSE"
    | "ADJUST"
    | "REVERSE";

  const attendanceStatusOptions: Array<{
    status: AttendanceStatus;
    label: string;
    shortLabel: string;
  }> = [
    { status: "P", label: "Present", shortLabel: "P" },
    { status: "A", label: "Absent", shortLabel: "A" },
    { status: "WO", label: "Week off", shortLabel: "WO" },
    { status: "HD", label: "Half day", shortLabel: "HD" },
  ];

  const subscribeToNothing = () => () => {};
  const getClientSnapshot = () => true;
  const getServerSnapshot = () => false;

  function ModalPortal({ children }: { children: ReactNode }) {
    const isClient = useSyncExternalStore(
      subscribeToNothing,
      getClientSnapshot,
      getServerSnapshot,
    );
    return isClient ? createPortal(children, document.body) : null;
  }

  function dashboardPercentClass(value: number, prefix: "dashboard-width" | "dashboard-rate") {
    const percent = Math.max(0, Math.min(100, Math.round(value)));
    return `${prefix}-${percent}`;
  }

  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const details = Array.isArray(payload.details)
        ? payload.details
            .map((detail: { path?: string; message?: string }) =>
              [detail.path, detail.message].filter(Boolean).join(": "),
            )
            .filter(Boolean)
            .join(" ")
        : typeof payload.details === "string"
          ? payload.details
          : "";
      throw new Error(
        details
          ? `${payload.error ?? "Request failed."} ${details}`
          : (payload.error ?? "Request failed."),
      );
    }
    return payload as T;
  }

  type ExportFormat = "xlsx" | "csv";

  async function downloadReport(url: string, format: ExportFormat) {
    const response = await fetch(url);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? "Report export failed.");
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (
      format === "csv"
        ? !contentType.includes("text/csv")
        : !contentType.includes(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          )
    )
      throw new Error("The server returned an unexpected report file.");

    const blob = await response.blob();
    if (!blob.size) throw new Error("The exported report is empty.");
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download =
      response.headers
        .get("content-disposition")
        ?.match(/filename="([^"]+)"/)?.[1] ??
      `attendance-report.${format}`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  function PageHead({
    title,
    description,
    action,
    className,
  }: {
    title: string;
    description: string;
    action?: React.ReactNode;
    className?: string;
  }) {
    return (
      <div className={`page-head${className ? ` ${className}` : ""}`}>
        <div>
          <div className="eyebrow">LA MILANO / OPERATIONS</div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {action}
      </div>
    );
  }

  function Notice({
    error,
    success,
    refreshing = false,
  }: {
    error: string;
    success: string;
    refreshing?: boolean;
  }) {
    if (error)
      return (
        <AutoDismissNotice
          key={`error:${error}`}
          message={error}
          variant="error"
        />
      );
    if (success)
      return (
        <AutoDismissNotice
          key={`success:${success}`}
          message={success}
          variant="success"
        />
      );
    if (refreshing)
      return (
        <div className="refreshing-notice" role="status">
          <RefreshSpinner size={22} />
          Updating results…
        </div>
      );
    return null;
  }

  function RefreshSpinner({ size = 28 }: { size?: number }) {
    return (
      <Image
        className="refresh-spinner"
        src="/Spinner/spinner.gif"
        width={size}
        height={size}
        unoptimized
        alt=""
        aria-hidden="true"
      />
    );
  }

  function Loading() {
    return (
      <div className="loading-state">
        <RefreshSpinner />
        Loading records
      </div>
    );
  }

  export function WorkspacePanel({
    section,
    user,
  }: {
    section: Section;
    user: {
      name: string;
      email: string;
      role: UserRole;
      permissions: Permission[];
    };
  }) {
    const [outlets, setOutlets] = useState<Outlet[]>([]);
    const activeOutlets = outlets.filter((outlet) => outlet.active);
    const employeeOutlets = activeOutlets;
    const [selectedOutlet, setSelectedOutlet] = useState("");
    const attendanceOutlets = activeOutlets;
    const attendanceOutletId =
      attendanceOutlets.length === 1 ? attendanceOutlets[0]._id : selectedOutlet;
    const attendanceAllOutlets =
      attendanceOutlets.length > 1 && !selectedOutlet;
    const today = getIndiaDate();
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [dashboardFetching, setDashboardFetching] = useState(false);
    const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);
    const attendanceReloadId = useRef(0);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [data, setData] = useState<WorkspaceData>({});
    const [date, setDate] = useState(() => getIndiaDate());
    const [month, setMonth] = useState(() => getIndiaMonth());
    const [dashboardDate, setDashboardDate] = useState(() => getIndiaDate());
    const [dashboardFrom, setDashboardFrom] = useState(
      () => `${getIndiaMonth()}-01`,
    );
    const [dashboardTo, setDashboardTo] = useState(() => getIndiaDate());
    const [dashboardPreset, setDashboardPreset] = useState("This Month");
    const [dashboardAttendanceFilter, setDashboardAttendanceFilter] = useState<
      "ALL" | "P" | "A" | "HD" | "WO" | "UNMARKED"
    >("ALL");
    const [dashboardExportBusy, setDashboardExportBusy] =
      useState<ExportFormat | null>(null);
    const [awayPeriod, setAwayPeriod] = useState("TODAY");
    const [awayFrom, setAwayFrom] = useState(() => `${getIndiaMonth()}-01`);
    const [awayTo, setAwayTo] = useState(() => getIndiaDate());
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [page, setPage] = useState(1);
    const [advanceStatus, setAdvanceStatus] = useState<
      "ALL" | "PENDING" | "APPROVED" | "REJECTED"
    >("ALL");
    const [isAdvanceFormOpen, setIsAdvanceFormOpen] = useState(false);
    const [advanceOutletId, setAdvanceOutletId] = useState("");
    const [advanceEmployeeId, setAdvanceEmployeeId] = useState("");
    const [isAttendanceUnlockOpen, setIsAttendanceUnlockOpen] = useState(false);
    const [attendanceUnlockReason, setAttendanceUnlockReason] = useState("");
    const [isAttendanceConfirmOpen, setIsAttendanceConfirmOpen] =
      useState(false);
    const [isAttendanceCorrectionOpen, setIsAttendanceCorrectionOpen] =
      useState(false);
    const [attendanceCorrectionReason, setAttendanceCorrectionReason] =
      useState("");
    const [pendingAttendanceAction, setPendingAttendanceAction] = useState<
      "SAVE" | "SUBMIT" | null
    >(null);
    const [attendanceSubmitConfirmation, setAttendanceSubmitConfirmation] =
      useState(true);
    const [newAccountProfile, setNewAccountProfile] = useState("");
    const [salaryGenerateEmployee, setSalaryGenerateEmployee] =
      useState<PayrollEmployeeView | null>(null);
    const [salaryManageRecord, setSalaryManageRecord] =
      useState<SalaryView | null>(null);
    const [loanToEdit, setLoanToEdit] = useState<LoanView | null>(null);
    const [loanAction, setLoanAction] = useState<{
      loan: LoanView;
      action: LoanActionName;
    } | null>(null);
    const [loanOutletId, setLoanOutletId] = useState("");
    const [loanEmployeeId, setLoanEmployeeId] = useState("");
    const [loanStatusFilter, setLoanStatusFilter] = useState("ONGOING");
    const [loanSearch, setLoanSearch] = useState("");
    const [loanFormMethod, setLoanFormMethod] = useState<
      "FIXED_AMOUNT" | "FIXED_INSTALLMENTS" | "DATE_RANGE"
    >("FIXED_AMOUNT");
    const [loanFormAmount, setLoanFormAmount] = useState("");
    const [loanFormMonthlyAmount, setLoanFormMonthlyAmount] = useState("");
    const [loanFormInstallmentCount, setLoanFormInstallmentCount] = useState("10");
    const [loanFormStartMonth, setLoanFormStartMonth] = useState(getIndiaMonth);
    const [loanFormEndMonth, setLoanFormEndMonth] = useState(getIndiaMonth);
    const [loanHistory, setLoanHistory] = useState<{
      employeeName: string;
      installments: Array<Record<string, unknown>>;
      transactions: Array<Record<string, unknown>>;
    } | null>(null);
    async function reload() {
      const reloadId = ++attendanceReloadId.current;
      if (section !== "dashboard") {
        if (!loading) setRefreshing(true);
      } else {
        setDashboardFetching(true);
      }
      setError("");
      const commitData = (nextData: WorkspaceData) => {
        if (reloadId === attendanceReloadId.current) setData(nextData);
      };
      try {
        if (section === "dashboard") {
          const dashboardParams = new URLSearchParams({
            date: dashboardDate,
            from: dashboardFrom,
            to: dashboardTo,
          });
          const awayDates = getAwayDateRange(
            awayPeriod,
            awayFrom,
            awayTo,
            today,
          );
          dashboardParams.set("awayFrom", awayDates.from);
          dashboardParams.set("awayTo", awayDates.to);
          if (selectedOutlet) dashboardParams.set("outletId", selectedOutlet);
          dashboardParams.set("parts", "summary");
          const dashboardUrl = `/api/dashboard?${dashboardParams.toString()}`;
          const dashboard = await request<WorkspaceData>(dashboardUrl);
          commitData(dashboard);
        }
        if (section === "attendance") {
          if (attendanceOutletId) {
            const attendanceData = await request<WorkspaceData>(
                `/api/attendance?outletId=${attendanceOutletId}&date=${date}`,
              );
            commitData(attendanceData);
          } else if (attendanceOutlets.length > 1) {
            const attendanceData = await request<WorkspaceData>(
              `/api/attendance?date=${date}`,
            );
            commitData(attendanceData);
          } else if (reloadId === attendanceReloadId.current) {
            commitData({});
          }
        }
        if (section === "employees")
          commitData(
            await request<WorkspaceData>(
              `/api/employees?page=${page}&pageSize=20&q=${encodeURIComponent(debouncedSearch)}${selectedOutlet ? `&outletId=${selectedOutlet}` : ""}`,
            ),
          );
        if (section === "advances") {
          const advanceParams = new URLSearchParams({ page: String(page) });
          if (selectedOutlet) advanceParams.set("outletId", selectedOutlet);
          if (advanceStatus !== "ALL")
            advanceParams.set("status", advanceStatus);
          const [advances, employees, outlets] = await Promise.all([
            request<WorkspaceData>(
              `/api/advances?${advanceParams.toString()}`,
            ),
            request<WorkspaceData>(
              "/api/employees?pageSize=100",
            ),
            request<WorkspaceData>("/api/outlets"),
          ]);
          commitData({
            ...advances,
            employees: employees.employees,
            outlets: outlets.outlets,
          });
        }
        if (section === "loans")
          commitData(
            await request<WorkspaceData>(
              `/api/loans?month=${month}${selectedOutlet ? `&outletId=${selectedOutlet}` : ""}`,
            ),
          );
        if (section === "salary" && month)
          commitData(
            await request<WorkspaceData>(
              `/api/payroll?month=${month}${selectedOutlet ? `&outletId=${selectedOutlet}` : ""}`,
            ),
          );
        if (section === "outlets") {
          const outletData = await request<WorkspaceData>("/api/outlets");
          const refreshedOutlets = outletData.outlets ?? [];
          if (reloadId === attendanceReloadId.current) {
            setData(outletData);
            setOutlets(refreshedOutlets);
          }
          const refreshedActiveOutlets = refreshedOutlets.filter(
            (outlet) => outlet.active,
          );
          if (reloadId === attendanceReloadId.current) {
            if (refreshedActiveOutlets.length === 1)
              setSelectedOutlet(refreshedActiveOutlets[0]._id);
            else
              setSelectedOutlet((current) =>
                refreshedActiveOutlets.some(
                  (outlet) => outlet._id === current,
                )
                  ? current
                  : "",
              );
          }
        }
        if (section === "access") {
          const [users, designations] = await Promise.all([
            request<WorkspaceData>("/api/users"),
            request<{ designations: DesignationView[] }>("/api/designations"),
          ]);
          commitData({ ...users, designations: designations.designations });
        }
        if (section === "activeLogs") {
          const params = new URLSearchParams({ page: "0" });
          if (selectedOutlet) params.set("outletId", selectedOutlet);
          commitData(
            await request<WorkspaceData>(
              `/api/audit?${params.toString()}`,
            ),
          );
        }
        if (section === "settings")
          commitData(await request<WorkspaceData>("/api/settings"));
      } catch (caught) {
        if (reloadId === attendanceReloadId.current)
          setError(
            caught instanceof Error ? caught.message : "Unable to load records.",
          );
      } finally {
        if (reloadId === attendanceReloadId.current) {
          setLoading(false);
          setRefreshing(false);
          setDashboardFetching(false);
        }
      }
    }

    const reloadCurrentView = useEffectEvent(() => {
      void reload();
    });
    useEffect(() => {
      let cancelled = false;
      void request<{ outlets: Outlet[] }>("/api/outlets")
        .then((result) => {
          if (cancelled) return;
          setOutlets(result.outlets);
          const accessibleActiveOutlets = result.outlets.filter(
            (outlet) => outlet.active,
          );
          if (accessibleActiveOutlets.length === 1)
            setSelectedOutlet(accessibleActiveOutlets[0]._id);
          else
            setSelectedOutlet((current) =>
              accessibleActiveOutlets.some(
                (outlet) => outlet._id === current,
              )
                ? current
                : "",
            );
        })
        .catch((caught) => {
          if (!cancelled)
            setError(
              caught instanceof Error
                ? caught.message
                : "Unable to load outlets.",
            );
        });
      return () => {
        cancelled = true;
      };
    }, []);
    useEffect(() => {
      if (user.role !== "MAIN_ADMIN") return;
      const savedPreference = window.localStorage.getItem(
        `attendance-submit-confirmation:${user.email}`,
      );
      if (savedPreference !== null)
        void Promise.resolve().then(() =>
          setAttendanceSubmitConfirmation(savedPreference === "true"),
        );
    }, [user.email, user.role]);
    useEffect(() => {
      const timeout = window.setTimeout(
        () => setDebouncedSearch(search),
        300,
      );
      return () => window.clearTimeout(timeout);
    }, [search]);
    useEffect(() => {
      void Promise.resolve().then(() => reloadCurrentView());
    }, [
      section,
      selectedOutlet,
      attendanceOutletId,
      attendanceOutlets.length,
      date,
      month,
      dashboardDate,
      dashboardFrom,
      dashboardTo,
      debouncedSearch,
      page,
      advanceStatus,
    ]);

    function applyDashboardPreset(value: string) {
      setDashboardPreset(value);
      if (value === "Custom") return;
      const end = new Date(`${today}T00:00:00.000Z`);
      const start = new Date(end);
      if (value === "Today") {
        setDashboardFrom(today);
        setDashboardTo(today);
        setDashboardDate(today);
        return;
      }
      if (value === "This Month") start.setUTCDate(1);
      if (value === "Last Month") {
        start.setUTCDate(1);
        start.setUTCMonth(start.getUTCMonth() - 1);
        end.setUTCDate(0);
      }
      setDashboardDate(end.toISOString().slice(0, 10));
      setDashboardFrom(start.toISOString().slice(0, 10));
      setDashboardTo(end.toISOString().slice(0, 10));
    }

    async function exportDashboardAttendance(
      format: ExportFormat,
      filters: {
        from: string;
        to: string;
        outletId: string;
        employeeId: string;
      },
    ) {
      setDashboardExportBusy(format);
      setError("");
      try {
        const params = new URLSearchParams({
          type: "attendance",
          from: filters.from,
          to: filters.to,
          format,
        });
        if (filters.outletId) params.set("outletId", filters.outletId);
        if (filters.employeeId) params.set("employeeId", filters.employeeId);
        await downloadReport(
          `/api/reports/export?${params.toString()}`,
          format,
        );
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to export attendance.",
        );
      } finally {
        setDashboardExportBusy(null);
      }
    }

    async function exportWhoIsAway(
      format: ExportFormat,
      rows: WhoIsAwayView[],
    ) {
      setDashboardExportBusy(format);
      setError("");
      try {
        if (!rows.length) {
          setError(
            "There are no absent or half-day attendance records to export.",
          );
          return;
        }
        const range = getAwayDateRange(awayPeriod, awayFrom, awayTo, today);
        const params = new URLSearchParams({
          type: "away",
          format,
          from: range.from,
          to: range.to,
        });
        if (selectedOutlet) params.set("outletId", selectedOutlet);
        await downloadReport(
          `/api/reports/export?${params.toString()}`,
          format,
        );
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to export attendance records.",
        );
      } finally {
        setDashboardExportBusy(null);
      }
    }

    async function submit(
      event: FormEvent<HTMLFormElement>,
      url: string,
      method = "POST",
      after = reload,
    ) {
      event.preventDefault();
      setBusy(true);
      setError("");
      setSuccess("");
      try {
        const form = event.currentTarget;
        const formData = new FormData(form);
        const body = normalizeForm(Object.fromEntries(formData.entries()));
        if (body.designationId === "") delete body.designationId;
        for (const key of ["outletIds", "permissions"])
          if (formData.has(key)) body[key] = formData.getAll(key).map(String);
        if (url === "/api/users") {
          const selectedProfile = String(body.accessProfile ?? "");
          delete body.accessProfile;
          if (selectedProfile === "MAIN_ADMIN") {
            body.role = "MAIN_ADMIN";
            delete body.outletIds;
            delete body.designationId;
          } else if (selectedProfile.startsWith("designation:")) {
            body.role = "OUTLET_USER";
            body.designationId = selectedProfile.slice("designation:".length);
          } else {
            throw new Error("Select Main Admin or a designation.");
          }
        }
        if (
          url === "/api/users" &&
          !window.confirm(
            "Provision this account with the selected access profile?",
          )
        )
          return;
        await request(url, { method, body: JSON.stringify(body) });
        setSuccess("Changes saved.");
        form.reset();
        if (url === "/api/users") setNewAccountProfile("");
        await after();
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Unable to save changes.",
        );
      } finally {
        setBusy(false);
      }
    }

    async function mutate(
      url: string,
      body: unknown,
      method = "POST",
      successMessage = "Changes saved.",
    ) {
      setBusy(true);
      setError("");
      setSuccess("");
      try {
        await request(url, { method, body: JSON.stringify(body) });
        setSuccess(successMessage);
        await reload();
        return true;
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Unable to save changes.",
        );
        return false;
      } finally {
        setBusy(false);
      }
    }

    const outletSelect = (
      <select
        value={selectedOutlet}
        onChange={(event) => {
          setSelectedOutlet(event.target.value);
        }}
        aria-label="Select outlet"
      >
        {activeOutlets.length !== 1 && (
          <option value="">All accessible outlets</option>
        )}
        {activeOutlets.map((outlet) => (
          <option key={outlet._id} value={outlet._id}>
            {outlet.code} · {outlet.name}
          </option>
        ))}
      </select>
    );
    const toolbar = (
      <div className="toolbar">
        {outletSelect}
        {section === "dashboard" && (
          <>
            <select
              aria-label="Dashboard reporting period"
              value={dashboardPreset}
              onChange={(event) => applyDashboardPreset(event.target.value)}
            >
              <option>This Month</option>
              <option>Last Month</option>
              <option>Today</option>
              <option>Custom</option>
            </select>
            {dashboardPreset === "Custom" && (
              <>
                <input
                  type="date"
                  aria-label="Dashboard range start date"
                  value={dashboardFrom}
                  max={dashboardTo}
                  onChange={(event) => {
                    setDashboardFrom(event.target.value);
                    setDashboardPreset("Custom");
                  }}
                />
                <input
                  type="date"
                  aria-label="Dashboard range end date"
                  value={dashboardTo}
                  min={dashboardFrom}
                  max={today}
                  onChange={(event) => {
                    setDashboardTo(event.target.value);
                    setDashboardDate(event.target.value);
                    setDashboardPreset("Custom");
                  }}
                />
              </>
            )}
          </>
        )}
        <button
          className="icon-button"
          title="Refresh"
          aria-label="Refresh"
          onClick={() => {
            if (section === "dashboard")
              setDashboardRefreshKey((current) => current + 1);
            void reload();
          }}
        >
          <RefreshCw size={17} />
        </button>
      </div>
    );

    const dashboardAttendance =
      data.metrics?.attendance ?? { P: 0, A: 0, HD: 0, WO: 0 };
    const dashboardRangeAttendance =
      data.metrics?.periodAttendance ?? dashboardAttendance;
    const dashboardMarkedCount =
      dashboardRangeAttendance.P +
      dashboardRangeAttendance.A +
      dashboardRangeAttendance.HD;
    const dashboardAttendanceRate =
      dashboardMarkedCount > 0
        ? Number(
            (
              ((dashboardRangeAttendance.P +
                dashboardRangeAttendance.HD / 2) /
                dashboardMarkedCount) *
              100
            ).toFixed(1),
          )
        : null;
    const dashboardActiveOutlets = data.metrics?.activeOutlets ?? 0;
    const dashboardSubmittedOutlets =
      data.metrics?.submittedOutlets ?? 0;
    const dashboardSubmissionRate =
      dashboardActiveOutlets > 0
        ? Math.round(
            (dashboardSubmittedOutlets / dashboardActiveOutlets) * 100,
          )
        : 0;
    const rateChange = data.metrics?.attendanceRateChange ?? null;

    if (section === "dashboard")
      return (
        <div
          className={`content-area${!loading && dashboardFetching ? " dashboard-refreshing" : ""}`}
          aria-busy={!loading && dashboardFetching}
        >
          <Notice
            error={error}
            success={success}
            refreshing={!loading && dashboardFetching}
          />
          {loading ? (
            <Loading />
          ) : (
            <>
              <section className="dashboard-hero">
                <div className="dashboard-hero-copy">
                  <span className="dashboard-hero-kicker">
                    <span /> YOUR TEAM, AT A GLANCE
                  </span>
                  <h2>Good service starts with a good team.</h2>
                  <p>
                    Live analytics snapshot · {formatDate(data.today ?? dashboardDate)}
                  </p>
                  <div className="dashboard-insights">
                    <span><CircleCheck size={14} /> {dashboardAttendance.P} present</span>
                    <span><Building2 size={14} /> {data.metrics?.missingSubmissions ?? 0} outlets to submit</span>
                    {user.permissions.includes("advances.approve") &&
                      (data.metrics?.pendingAdvanceApprovals ?? 0) > 0 && (
                        <span className="dashboard-insight-pending">
                          <Bell size={14} /> {data.metrics?.pendingAdvanceApprovals} pending approval
                        </span>
                      )}
                    {data.metrics?.bestOutletCode && (
                      <span>
                        <Building2 size={14} /> Best outlet: {data.metrics.bestOutletCode} ({data.metrics.bestOutletRate?.toFixed(1)}%)
                      </span>
                    )}
                  </div>
                  <div className="dashboard-hero-actions">
                    {user.permissions.includes("attendance.write") && (
                      <Link className="button button-primary" href="/attendance">
                        <CalendarClock size={16} /> Mark attendance
                      </Link>
                    )}
                    {user.permissions.includes("salary.generate") && (
                      <Link className="button button-secondary" href="/salary">
                        <Banknote size={16} /> Run payroll
                      </Link>
                    )}
                    {user.permissions.includes("employees.read") && (
                      <Link className="button button-secondary" href="/employees">
                        <Users size={16} /> Manage team
                      </Link>
                    )}
                  </div>
                </div>
                <div className="dashboard-hero-side">
                  <div className="dashboard-hero-date">
                    <span>REPORTING DATE</span>
                    <strong>{formatDate(data.today ?? dashboardDate)}</strong>
                  </div>
                  <div className="dashboard-hero-ornament" aria-hidden="true">
                    <span>LM</span>
                  </div>
                  <span className="dashboard-hero-brand">ATTENDANCE BY ROSHAN</span>
                </div>
              </section>
              <div className="dashboard-filter-row">
                {toolbar}
                {user.permissions.includes("advances.approve") &&
                  (data.metrics?.pendingAdvanceApprovals ?? 0) > 0 && (
                    <Link className="dashboard-pending-chip" href="/advances">
                      <Bell size={13} /> {data.metrics?.pendingAdvanceApprovals} pending approval
                    </Link>
                  )}
              </div>
              <div className="dashboard-kpi-grid">
                <article className="dashboard-kpi-card">
                  <div className="dashboard-kpi-top">
                    <span>Attendance rate</span>
                    <span className="dashboard-kpi-icon dashboard-kpi-green"><CalendarDays size={17} /></span>
                  </div>
                  <strong>{dashboardAttendanceRate === null ? "—" : `${dashboardAttendanceRate}%`}</strong>
                  <div className="dashboard-kpi-foot">
                    <span>{dashboardMarkedCount ? `${formatDate(dashboardFrom)} – ${formatDate(dashboardTo)}` : "No attendance marked yet"}</span>
                    <span className="dashboard-kpi-neutral">
                      {rateChange === null ? "—" : `${rateChange >= 0 ? "+" : ""}${rateChange.toFixed(1)} pp vs prior 7 days`}
                    </span>
                  </div>
                  <div className="dashboard-kpi-status-bars" aria-hidden="true">
                    {(["P", "HD", "A", "WO"] as const).map((status) => {
                      const count = dashboardRangeAttendance[status];
                      const total = Object.values(dashboardRangeAttendance).reduce((sum, value) => sum + value, 0);
                      const percentage = total
                        ? Math.max((count / total) * 100, count ? 4 : 0)
                        : 0;
                      return (
                        <i
                          key={status}
                          className={`status-${status.toLowerCase()} ${dashboardPercentClass(percentage, "dashboard-width")}`}
                        />
                      );
                    })}
                  </div>
                  <small>Half-days count as half; week-offs excluded · live records</small>
                </article>
                <article className="dashboard-kpi-card">
                  <div className="dashboard-kpi-top">
                    <span>Net payroll</span>
                    <span className="dashboard-kpi-icon dashboard-kpi-rose"><Banknote size={17} /></span>
                  </div>
                  <strong>{data.metrics?.netPayable == null ? "—" : currency(data.metrics.netPayable)}</strong>
                  <div className="dashboard-kpi-foot">
                    <span>{data.metrics?.netPayable == null ? "Salary permission required" : `Accrued through ${formatDate(dashboardDate)}`}</span>
                    {user.permissions.includes("salary.read") && <Link href="/salary" className="dashboard-kpi-link">View payroll <ArrowUpRight size={13} /></Link>}
                  </div>
                  {data.metrics?.grossSalary != null && (
                    <div className="dashboard-kpi-extra">Gross earnings <strong>{currency(data.metrics.grossSalary)}</strong></div>
                  )}
                  {data.metrics?.projectedMonthEndBase != null && (
                    <div className="dashboard-kpi-extra">Projected month-end base <strong>{currency(data.metrics.projectedMonthEndBase)}</strong></div>
                  )}
                  <small>Projection uses monthly base salaries before attendance and deductions</small>
                </article>
                <article className="dashboard-kpi-card">
                  <div className="dashboard-kpi-top">
                    <span>Active team</span>
                    <span className="dashboard-kpi-icon dashboard-kpi-sage"><Users size={17} /></span>
                  </div>
                  <strong>{data.metrics?.activeEmployees ?? 0}</strong>
                  <div className="dashboard-kpi-foot">
                    <span>{data.metrics?.fullTimeEmployees ?? 0} full-time · {data.metrics?.partTimeEmployees ?? 0} part-time</span>
                    {user.permissions.includes("employees.read") && <Link href="/employees" className="dashboard-kpi-link">View team <ArrowUpRight size={13} /></Link>}
                  </div>
                  <div className="dashboard-avatar-stack" aria-label="Team member initials">
                    {(data.attendanceEmployees ?? []).slice(0, 5).map((employee) => (
                      <span key={employee.employeeId} title={employee.employeeName}>{employee.employeeName.slice(0, 1).toUpperCase()}</span>
                    ))}
                    {(!data.attendanceEmployees || data.attendanceEmployees.length === 0) && (
                      <span className="dashboard-avatar-empty"><BriefcaseBusiness size={13} /></span>
                    )}
                  </div>
                  <small>{dashboardActiveOutlets} active {dashboardActiveOutlets === 1 ? "outlet" : "outlets"}</small>
                </article>
                <article className="dashboard-kpi-card dashboard-submission-card">
                  <div className="dashboard-kpi-top">
                    <span>Outlet submissions</span>
                    <span className="dashboard-kpi-icon dashboard-kpi-gold"><CircleCheck size={17} /></span>
                  </div>
                  <div className="dashboard-submission-content">
                    <div>
                      <strong>{dashboardSubmittedOutlets}<span>/{dashboardActiveOutlets}</span></strong>
                      <small>outlets submitted</small>
                    </div>
                    <div className={`dashboard-submission-ring ${dashboardPercentClass(dashboardSubmissionRate, "dashboard-rate")}`} aria-label={`${dashboardSubmissionRate}% outlets submitted`}>
                      <span>{dashboardSubmissionRate}%</span>
                    </div>
                  </div>
                  <div className="dashboard-kpi-foot">
                    <span>{data.metrics?.missingSubmissions ?? 0} awaiting submission</span>
                    <span className="dashboard-kpi-neutral">{dashboardSubmissionRate}% complete</span>
                  </div>
                </article>
              </div>
              {user.permissions.includes("attendance.read") && (
                <LazySection minHeight={360}>
                  <DashboardPartLoader
                    part="attendance"
                    filters={{
                      date: dashboardDate,
                      from: dashboardFrom,
                      to: dashboardTo,
                      outletId: selectedOutlet,
                      refreshKey: dashboardRefreshKey,
                    }}
                  >
                    {(attendanceData) => (
                      <DashboardAttendanceOverview
                        employees={attendanceData.attendanceEmployees ?? []}
                        date={dashboardDate}
                        filter={dashboardAttendanceFilter}
                        onFilterChange={setDashboardAttendanceFilter}
                      />
                    )}
                  </DashboardPartLoader>
                </LazySection>
              )}
              {user.permissions.includes("attendance.read") && (
                <LazySection minHeight={680}>
                  <DashboardPartLoader
                    part="trend"
                    filters={{
                      date: dashboardDate,
                      from: dashboardFrom,
                      to: dashboardTo,
                      outletId: selectedOutlet,
                      refreshKey: dashboardRefreshKey,
                    }}
                  >
                    {(trendData) => (
                      <DashboardAnalyticsSections
                        days={trendData.attendanceTrend ?? []}
                        from={dashboardFrom}
                        to={dashboardTo}
                        metrics={data.metrics}
                        selectedOutlet={selectedOutlet}
                        onSelectOutlet={setSelectedOutlet}
                        canReadEmployees={user.permissions.includes("employees.read")}
                        canReadSalary={user.permissions.includes("salary.read")}
                      />
                    )}
                  </DashboardPartLoader>
                </LazySection>
              )}
              {user.permissions.includes("attendance.read") && (
                <LazySection minHeight={300}>
                  <DashboardPartLoader
                    part="away"
                    filters={{
                      date: dashboardDate,
                      from: dashboardFrom,
                      to: dashboardTo,
                      outletId: selectedOutlet,
                      awayFrom: getAwayDateRange(
                        awayPeriod,
                        awayFrom,
                        awayTo,
                        today,
                      ).from,
                      awayTo: getAwayDateRange(
                        awayPeriod,
                        awayFrom,
                        awayTo,
                        today,
                      ).to,
                      refreshKey: dashboardRefreshKey,
                    }}
                  >
                    {(awayData) => (
                      <WhoIsAwayPanel
                        employees={awayData.whoIsAway ?? []}
                        period={awayPeriod}
                        customFrom={awayFrom}
                        customTo={awayTo}
                        canExport={user.permissions.includes("reports.export")}
                        exportBusy={dashboardExportBusy}
                        onPeriodChange={setAwayPeriod}
                        onCustomFromChange={setAwayFrom}
                        onCustomToChange={setAwayTo}
                        onExport={(format) =>
                          void exportWhoIsAway(
                            format,
                            awayData.whoIsAway ?? [],
                          )
                        }
                      />
                    )}
                  </DashboardPartLoader>
                </LazySection>
              )}
              <LazySection minHeight={300}>
                <DashboardPartLoader
                  part="outlets"
                  filters={{
                    date: dashboardDate,
                    from: dashboardFrom,
                    to: dashboardTo,
                    outletId: selectedOutlet,
                    refreshKey: dashboardRefreshKey,
                  }}
                >
                  {(outletData) => (
                    <DashboardOutletOperations
                      date={dashboardDate}
                      outlets={outletData.outlets ?? []}
                    />
                  )}
                </DashboardPartLoader>
              </LazySection>
              {user.permissions.includes("employees.read") && (
                <LazySection minHeight={440}>
                  <EmployeeAttendanceTable
                    key={`${selectedOutlet}|${dashboardFrom}|${dashboardTo}`}
                    canReadSalary={user.permissions.includes("salary.read")}
                    globalFrom={dashboardFrom}
                    globalTo={dashboardTo}
                    globalOutletId={selectedOutlet}
                    outlets={activeOutlets}
                    canExport={user.permissions.includes("reports.export")}
                    exportBusy={dashboardExportBusy}
                    onExport={(format, filters) =>
                      void exportDashboardAttendance(format, filters)
                    }
                    title={
                      dashboardPreset === "This Month"
                        ? "Employee attendance this month"
                        : dashboardPreset === "Last Month"
                          ? "Employee attendance last month"
                          : "Employee attendance by date"
                    }
                    description="Choose an outlet, employee, and date range to review or download the submitted attendance report."
                  />
                </LazySection>
              )}
            </>
          )}
        </div>
      );

    const attendanceEmployees = data.employees ?? [];
    const attendanceCounts = attendanceEmployees.reduce(
      (counts, employee) => {
        if (employee.attendanceStatus)
          counts[employee.attendanceStatus] += 1;
        return counts;
      },
      { P: 0, A: 0, WO: 0, HD: 0 },
    );
    const markedAttendanceCount = attendanceEmployees.filter(
      (employee) => employee.attendanceStatus,
    ).length;
    const submittedAttendanceCount = attendanceEmployees.filter(
      (employee) => employee.attendanceSubmitted,
    ).length;
    const allAttendanceSubmitted =
      attendanceEmployees.length > 0 &&
      submittedAttendanceCount === attendanceEmployees.length;
    const isMainAdmin = user.role === "MAIN_ADMIN";
    const hasMarkedUnsubmittedAttendance = attendanceEmployees.some(
      (employee) =>
        employee.attendanceStatus &&
        (!employee.attendanceSubmitted ||
          (isMainAdmin &&
            employee.attendanceStatus !== employee.savedAttendanceStatus)),
    );
    const hasAttendanceSaveWork = attendanceEmployees.some(
      (employee) =>
        (!employee.attendanceSubmitted &&
          (employee.attendanceStatus || employee.attendanceEntryExists)) ||
        (isMainAdmin &&
          employee.attendanceSubmitted &&
          employee.attendanceStatus !== employee.savedAttendanceStatus),
    );
    const hasAdminSubmittedCorrection = isMainAdmin && attendanceEmployees.some(
      (employee) =>
        employee.attendanceSubmitted &&
        employee.attendanceStatus !== employee.savedAttendanceStatus,
    );
    const canWriteAttendance = user.permissions.includes("attendance.write");
    const canSubmitAttendance =
      canWriteAttendance && user.permissions.includes("attendance.submit");

    if (section === "attendance")
      return (
        <div className="content-area">
          <PageHead
            title="Daily attendance"
            description="Review all outlets or choose one outlet to record attendance. Submit locks marked employees; blank employees remain editable."
            action={
              <div className="toolbar attendance-toolbar">
                {user.role === "MAIN_ADMIN" && (
                  <label className="attendance-confirmation-toggle">
                    <input
                      type="checkbox"
                      checked={attendanceSubmitConfirmation}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setAttendanceSubmitConfirmation(enabled);
                        window.localStorage.setItem(
                          `attendance-submit-confirmation:${user.email}`,
                          String(enabled),
                        );
                      }}
                    />
                    <span>Alert</span>
                  </label>
                )}
                <label className="attendance-date-picker">
                  <span>{formatDate(date)}</span>
                  <CalendarDays size={16} aria-hidden="true" />
                  <input
                    type="date"
                    value={date}
                    max={today}
                    onChange={(event) => {
                      if (event.target.value && event.target.value <= today)
                        setDate(event.target.value);
                    }}
                    aria-label="Attendance date"
                  />
                </label>
                {attendanceOutlets.length === 1 ? (
                  <span className="attendance-single-outlet">
                    {attendanceOutlets[0].name}
                  </span>
                ) : attendanceOutlets.length > 1 ? (
                  <select
                    value={selectedOutlet}
                    onChange={(event) => setSelectedOutlet(event.target.value)}
                    aria-label="Select outlet"
                  >
                    {attendanceOutlets.length !== 1 && (
                      <option value="">All accessible outlets</option>
                    )}
                    {attendanceOutlets.map((outlet) => (
                      <option key={outlet._id} value={outlet._id}>
                        {outlet.code} · {outlet.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="attendance-single-outlet">
                    No active outlets available
                  </span>
                )}
              </div>
            }
          />
          <Notice error={error} success={success} refreshing={refreshing} />
          {loading ? (
            <Loading />
          ) : (
            <section className="panel attendance-panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    {data.outlet?.code ??
                      (attendanceAllOutlets
                        ? "All accessible outlets"
                        : "Select an outlet")}{" "}
                    <span className="muted">/ {formatDate(date)}</span>
                  </h2>
                  <p>
                    {attendanceAllOutlets
                      ? `${data.submittedCount ?? 0} of ${data.outletCount ?? 0} outlets have submissions`
                      : submittedAttendanceCount > 0
                        ? allAttendanceSubmitted
                          ? data.day?.submittedAt
                            ? `All employees submitted ${formatDateTime(data.day.submittedAt)}`
                            : "All employees submitted"
                          : `${submittedAttendanceCount} of ${attendanceEmployees.length} employees submitted · remaining employees are not locked`
                        : "Draft · not submitted"}
                  </p>
                  {data.day?.updatedAt && (
                    <p className="sub-cell">
                      Last updated {formatDateTime(data.day.updatedAt)}
                    </p>
                  )}
                  {!!data.day?.corrections?.length && (
                    <p className="sub-cell">
                      {data.day.corrections.length} correction event(s) · latest:{" "}
                      {data.day.corrections.at(-1)?.reason}
                    </p>
                  )}
                </div>
                <div className="attendance-status-summary">
                  <span className="attendance-count-chip">
                    <i className="status-dot-present" /> Present {attendanceCounts.P}
                  </span>
                  <span className="attendance-count-chip">
                    <i className="status-dot-absent" /> Absent {attendanceCounts.A}
                  </span>
                  <span className="attendance-count-chip">
                    <i className="status-dot-weekoff" /> Week off {attendanceCounts.WO}
                  </span>
                  <span className="attendance-count-chip">
                    <i className="status-dot-half" /> Half day {attendanceCounts.HD}
                  </span>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {attendanceAllOutlets && <th>Outlet</th>}
                      <th>Employee</th>
                      <th>Designation</th>
                      <th>Status</th>
                      <th>Submission Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.employees ?? []).map((employee: Employee) => (
                      <tr key={employee._id}>
                        {attendanceAllOutlets && (
                          <td>
                            <strong>{employee.outletCode}</strong>
                            <span className="sub-cell">{employee.outletName}</span>
                          </td>
                        )}
                        <td>
                          <strong>{employee.fullName}</strong>
                          <span className="sub-cell">
                            {employee.employeeCode}
                          </span>
                        </td>
                        <td>{employee.designation}</td>
                        <td>
                          <div
                            className={`attendance-status-controls${employee.attendanceSubmitted && !isMainAdmin ? " is-locked" : ""}`}
                            role="group"
                            aria-label={`Attendance status for ${employee.fullName}`}
                          >
                            {attendanceStatusOptions.map(
                              ({ status, label, shortLabel }) => (
                              <button
                                key={status}
                                type="button"
                                className={`attendance-status-option attendance-status-${status.toLowerCase()}${employee.attendanceStatus === status ? " is-selected" : ""}`}
                                aria-label={label}
                                title={label}
                                aria-pressed={employee.attendanceStatus === status}
                                disabled={isAttendanceEntryLocked(
                                  !!employee.attendanceSubmitted,
                                  user.role,
                                )}
                                onClick={() =>
                                  setData((old) => ({
                                    ...old,
                                    employees: (old.employees ?? []).map((item) =>
                                      item._id === employee._id
                                        ? {
                                            ...item,
                                            attendanceStatus:
                                              item.attendanceStatus === status
                                                ? null
                                                : status,
                                          }
                                        : item,
                                    ),
                                  }))
                                }
                              >
                                {shortLabel}
                              </button>
                              ),
                            )}
                          </div>
                          {user.role !== "MAIN_ADMIN" &&
                            (employee.attendanceCorrectionCount ?? 0) >= 2 && (
                              <span className="sub-cell attendance-correction-lock">
                                Locked after 2 changes. Contact MAIN_ADMIN.
                              </span>
                            )}
                        </td>
                        <td>
                          <span
                            className={`badge ${employee.attendanceSubmitted ? "badge-green" : "badge-muted"}`}
                          >
                            {employee.attendanceSubmitted
                              ? "Submitted"
                              : employee.attendanceStatus
                                ? "Draft"
                                : "Not marked"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.employees?.length && (
                  <Empty>
                    {attendanceOutletId
                      ? "No active employees at this outlet."
                      : attendanceAllOutlets
                        ? "No active employees or attendance records are available for these outlets."
                        : "No active outlets available."}
                  </Empty>
                )}
              </div>
              <div className="panel-footer">
                <span>
                  {markedAttendanceCount} of {attendanceEmployees.length} marked
                </span>
                <div className="toolbar">
                  {attendanceAllOutlets && (
                    <span className="sub-cell">
                      Submit marked employees across accessible outlets.
                    </span>
                  )}
                  {!attendanceAllOutlets &&
                    data.day?.status === "SUBMITTED" &&
                    user.permissions.includes("attendance.unlock") && (
                      <button
                        className="button button-secondary"
                        disabled={busy}
                        onClick={() => setIsAttendanceUnlockOpen(true)}
                      >
                        Unlock for correction
                      </button>
                    )}
                  {(attendanceAllOutlets ||
                    data.day?.status !== "SUBMITTED" ||
                    !allAttendanceSubmitted ||
                    isMainAdmin) && (
                    <>
                      <button
                        disabled={
                          busy ||
                          (!attendanceOutletId && !attendanceAllOutlets) ||
                          !canWriteAttendance ||
                          !hasAttendanceSaveWork
                        }
                        className="button button-secondary"
                        onClick={() => saveAttendance("SAVE")}
                      >
                        <Check size={16} /> Save draft
                      </button>
                      <button
                        disabled={
                          busy ||
                          (!attendanceOutletId && !attendanceAllOutlets) ||
                          !canSubmitAttendance ||
                          !hasMarkedUnsubmittedAttendance
                        }
                        className="button button-primary"
                        onClick={() => saveAttendance("SUBMIT")}
                      >
                        <Send size={16} /> Submit & lock
                      </button>
                    </>
                  )}
                  {!attendanceAllOutlets &&
                    allAttendanceSubmitted &&
                    data.day?.status === "SUBMITTED" &&
                    !user.permissions.includes("attendance.unlock") && (
                      <span className="sub-cell">
                        Attendance submitted and locked.
                      </span>
                    )}
                </div>
              </div>
            </section>
          )}
          {isAttendanceUnlockOpen && (
            <div className="advance-modal-backdrop">
              <section
                className="advance-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="attendance-unlock-title"
              >
                <header className="advance-modal-heading">
                  <div>
                    <h2 id="attendance-unlock-title">
                      Unlock attendance for correction
                    </h2>
                    <p>
                      Attendance for {data.outlet?.name ?? "this outlet"} on{" "}
                      {formatDate(date)} will unlock immediately. A reason is optional.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Close unlock dialog"
                    disabled={busy}
                    onClick={() => {
                      setIsAttendanceUnlockOpen(false);
                      setAttendanceUnlockReason("");
                    }}
                  >
                    <X size={18} />
                  </button>
                </header>
                <form className="advance-edit-form" onSubmit={unlockAttendance}>
                  <label className="field">
                    <span>Reason (optional)</span>
                    <textarea
                      value={attendanceUnlockReason}
                      onChange={(event) =>
                        setAttendanceUnlockReason(event.target.value)
                      }
                      maxLength={500}
                      rows={3}
                      placeholder="Add a reason for the audit log"
                    />
                  </label>
                  <div className="toolbar">
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() => {
                        setIsAttendanceUnlockOpen(false);
                        setAttendanceUnlockReason("");
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="button button-primary"
                      disabled={busy}
                    >
                      Unlock now
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}
          {loanHistory && (
            <div className="advance-modal-backdrop">
              <section
                className="advance-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="loan-history-title"
              >
                <header className="advance-modal-heading">
                  <div>
                    <h2 id="loan-history-title">Repayment history</h2>
                    <p>{loanHistory.employeeName}</p>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Close repayment history"
                    onClick={() => setLoanHistory(null)}
                  >
                    <X size={16} />
                  </button>
                </header>
                <div className="salary-manage-content">
                  <h3>Installments</h3>
                  {loanHistory.installments.length ? (
                    <DataTable
                      headers={[
                        "Payroll month",
                        "Opening",
                        "Scheduled",
                        "Actual",
                        "Closing",
                        "Status / reason",
                        "Action by",
                        "Payroll reference",
                        "Recorded",
                      ]}
                      rows={loanHistory.installments.map((entry) => [
                        String(entry.payrollMonth ?? ""),
                        currency(Number(entry.openingBalance)),
                        currency(Number(entry.scheduledDeduction)),
                        currency(Number(entry.actualDeduction)),
                        currency(Number(entry.closingBalance)),
                        `${String(entry.status ?? "")}${entry.skipReason ? ` · ${String(entry.skipReason)}` : ""}${entry.reversalReason ? ` · Reversal: ${String(entry.reversalReason)}` : ""}`,
                        `${String(entry.actorName ?? "")}${entry.reversedByName ? ` · reversed by ${String(entry.reversedByName)}` : ""}`,
                        String(entry.payrollRecordId ?? ""),
                        String(entry.createdAt ?? ""),
                      ])}
                      empty="No installments recorded."
                      page={1}
                      pageSize={100}
                      total={loanHistory.installments.length}
                      onPageChange={() => {}}
                    />
                  ) : (
                    <p className="sub-cell">No installments recorded.</p>
                  )}
                  <h3>Adjustments and closures</h3>
                  {loanHistory.transactions.length ? (
                    <DataTable
                      headers={[
                        "Date",
                        "Type",
                        "Amount",
                        "Balance before",
                        "Balance after",
                        "Reason / reference",
                        "Action by",
                      ]}
                      rows={loanHistory.transactions.map((entry) => [
                        String(entry.transactionDate ?? ""),
                        String(entry.type ?? ""),
                        currency(Number(entry.amount)),
                        currency(Number(entry.balanceBefore)),
                        currency(Number(entry.balanceAfter)),
                        `${String(entry.reason ?? "")}${entry.reference ? ` · ${String(entry.reference)}` : ""}`,
                        String(entry.actorName ?? ""),
                      ])}
                      empty="No adjustment or closure transactions recorded."
                      page={1}
                      pageSize={100}
                      total={loanHistory.transactions.length}
                      onPageChange={() => {}}
                    />
                  ) : (
                    <p className="sub-cell">No adjustment or closure transactions recorded.</p>
                  )}
                </div>
              </section>
            </div>
          )}
          {isAttendanceCorrectionOpen && (
            <div className="advance-modal-backdrop">
              <section
                className="advance-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="attendance-correction-title"
              >
                <header className="advance-modal-heading">
                  <div>
                    <h2 id="attendance-correction-title">
                      Reason for attendance correction
                    </h2>
                    <p>
                      A reason is recorded in the attendance history and audit
                      log when changing submitted attendance.
                    </p>
                  </div>
                </header>
                <form
                  className="advance-edit-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const reason = attendanceCorrectionReason.trim();
                    const action = pendingAttendanceAction;
                    if (!reason || !action) return;
                    setIsAttendanceCorrectionOpen(false);
                    if (action === "SUBMIT" && attendanceSubmitConfirmation) {
                      setIsAttendanceConfirmOpen(true);
                      return;
                    }
                    setPendingAttendanceAction(null);
                    setAttendanceCorrectionReason("");
                    void submitAttendance(action, reason);
                  }}
                >
                  <label className="field">
                    <span>Reason (required)</span>
                    <textarea
                      value={attendanceCorrectionReason}
                      maxLength={500}
                      required
                      rows={3}
                      onChange={(event) =>
                        setAttendanceCorrectionReason(event.target.value)
                      }
                      placeholder="Explain why submitted attendance is being changed"
                    />
                  </label>
                  <div className="toolbar attendance-confirm-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() => {
                        setIsAttendanceCorrectionOpen(false);
                        setPendingAttendanceAction(null);
                        setAttendanceCorrectionReason("");
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="button button-primary"
                      disabled={busy || !attendanceCorrectionReason.trim()}
                    >
                      Continue
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}
          {isAttendanceConfirmOpen && (
            <div className="advance-modal-backdrop">
              <section
                className="advance-modal attendance-confirm-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="attendance-submit-title"
              >
                <header className="advance-modal-heading">
                  <div>
                    <h2 id="attendance-submit-title">
                      Confirm attendance submission
                    </h2>
                    <p>
                      Confirm attendance for{" "}
                      {attendanceAllOutlets
                        ? "all accessible outlets"
                        : (data.outlet?.name ??
                          data.outlet?.code ??
                          "this outlet")}{" "}
                      on {formatDate(date)}? This will save and lock only the
                      marked employees. Unmarked employees will remain
                      editable. For any changes, contact KULDEEP YADAV.
                    </p>
                  </div>
                </header>
                <div className="toolbar attendance-confirm-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() => {
                      setIsAttendanceConfirmOpen(false);
                      setPendingAttendanceAction(null);
                      setAttendanceCorrectionReason("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={busy}
                    onClick={() => {
                      setIsAttendanceConfirmOpen(false);
                      const action = pendingAttendanceAction ?? "SUBMIT";
                      const reason = attendanceCorrectionReason.trim();
                      setPendingAttendanceAction(null);
                      setAttendanceCorrectionReason("");
                      void submitAttendance(action, reason || undefined);
                    }}
                  >
                    Confirm
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      );

    async function saveAttendance(action: "SAVE" | "SUBMIT") {
      if (hasAdminSubmittedCorrection) {
        setPendingAttendanceAction(action);
        setAttendanceCorrectionReason("");
        setIsAttendanceCorrectionOpen(true);
        return;
      }
      if (
        action === "SUBMIT" &&
        (user.role !== "MAIN_ADMIN" || attendanceSubmitConfirmation)
      ) {
        setPendingAttendanceAction(action);
        setIsAttendanceConfirmOpen(true);
        return;
      }
      await submitAttendance(action);
    }

    async function submitAttendance(
      action: "SAVE" | "SUBMIT" = "SUBMIT",
      reason?: string,
    ) {
      const entriesByOutlet = new Map<
        string,
        {
          entries: Array<{ employeeId: string; status: AttendanceStatus }>;
          clearEmployeeIds: string[];
        }
      >();
      for (const employee of attendanceEmployees) {
        const isAdminCorrection =
          isMainAdmin &&
          employee.attendanceSubmitted &&
          employee.attendanceStatus !== employee.savedAttendanceStatus;
        if (employee.attendanceSubmitted && !isAdminCorrection) continue;
        const outletId = attendanceAllOutlets
          ? employee.outletId
          : attendanceOutletId;
        if (!outletId) continue;
        const group = entriesByOutlet.get(outletId) ?? {
          entries: [],
          clearEmployeeIds: [],
        };
        if (employee.attendanceStatus) {
          group.entries.push({
            employeeId: employee._id,
            status: employee.attendanceStatus,
          });
        } else if (employee.attendanceEntryExists) {
          group.clearEmployeeIds.push(employee._id);
        } else {
          continue;
        }
        entriesByOutlet.set(outletId, group);
      }
      const outletsWithAttendanceWork = [...entriesByOutlet].filter(
        ([, group]) =>
          group.entries.length > 0 || group.clearEmployeeIds.length > 0,
      );
      if (
        !outletsWithAttendanceWork.length ||
        (action === "SUBMIT" &&
          ![...entriesByOutlet.values()].some((group) => group.entries.length))
      ) {
        setError("Mark at least one unlocked employee before saving attendance.");
        return;
      }

      setBusy(true);
      setError("");
      setSuccess("");
      const failedOutlets: string[] = [];
      let submittedOutlets = 0;
      let draftOutlets = 0;
      try {
        for (const [outletId, group] of entriesByOutlet) {
          const outlet = attendanceOutlets.find(
            (item) => item._id === outletId,
          );
          const outletAction =
            action === "SUBMIT" && !group.entries.length ? "SAVE" : action;
          try {
            await request("/api/attendance", {
              method: "PUT",
              body: JSON.stringify({
                outletId,
                date,
                ...group,
                action: outletAction,
                reason,
              }),
            });
            if (outletAction === "SUBMIT") submittedOutlets += 1;
            else draftOutlets += 1;
          } catch (caught) {
            failedOutlets.push(
              `${outlet?.code ?? outletId}: ${
                caught instanceof Error
                  ? caught.message
                  : "Unable to save attendance."
              }`,
            );
          }
        }
        await reload();
        if (failedOutlets.length) {
          setError(
            `${submittedOutlets} outlet(s) submitted and ${draftOutlets} draft(s) saved; ${failedOutlets.length} failed. ${failedOutlets.join(" ")}`,
          );
        } else {
          setSuccess(action === "SUBMIT"
            ? `Attendance submitted for ${submittedOutlets} outlet(s) and drafts saved for ${draftOutlets} outlet(s).`
            : `Attendance draft saved for ${draftOutlets} outlet(s).`);
        }
      } finally {
        setBusy(false);
      }
    }

    async function unlockAttendance(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (!attendanceOutletId) return;
      const unlocked = await mutate("/api/attendance/unlock", {
        outletId: attendanceOutletId,
        date,
        reason: attendanceUnlockReason.trim() || undefined,
      });
      if (unlocked) {
        setIsAttendanceUnlockOpen(false);
        setAttendanceUnlockReason("");
      }
    }

    if (section === "employees")
      return (
        <div className="content-area">
          <PageHead
            title="Employees"
            description="Manage your team records and salary settings."
            action={
              <div className="toolbar">
                <label className="search-field">
                  <Search size={16} />
                  <input
                    value={search}
                    onChange={(event) => {
                      setPage(1);
                      setSearch(event.target.value);
                    }}
                    placeholder="Search employees"
                  />
                </label>
                {toolbar}
              </div>
            }
          />
          <Notice error={error} success={success} refreshing={refreshing} />
          {user.permissions.includes("employees.create") && (
            <EmployeeCreatePanel
              user={{ email: user.email, role: user.role }}
              outlets={employeeOutlets}
              initialOutletId={selectedOutlet}
              canManageDocuments={user.permissions.includes("employees.update")}
              onCreated={reload}
            />
          )}
          {user.role === "MAIN_ADMIN" && (
            <EmployeeImportPanel
              outlets={activeOutlets}
              selectedOutlet={selectedOutlet}
              onImported={reload}
            />
          )}
          {loading ? (
            <Loading />
          ) : (
            <DataTable
              headers={[
                "Employee",
                "Outlet",
                "Designation",
                ...(user.role === "OUTLET_USER" ? [] : ["Mobile"]),
                ...(user.role === "MAIN_ADMIN" ? ["Base salary"] : []),
                "Status",
                "Actions",
              ]}
              rows={(data.employees ?? []).map((employee: Employee) => {
                const cells: React.ReactNode[] = [
                  <span key="name">
                    <Link
                      className="employee-row-link"
                      href={`/employees/${employee._id}`}
                    >
                      <strong>{employee.fullName}</strong>
                    </Link>
                    <span className="sub-cell">{employee.employeeCode}</span>
                  </span>,
                  outlets.find((outlet) => outlet._id === employee.outletId)
                    ?.code ?? "—",
                  employee.designation,
                ];
                if (user.role !== "OUTLET_USER")
                  cells.push(employee.mobile ?? "—");
                if (user.role === "MAIN_ADMIN")
                  cells.push(currency(employee.monthlyBaseSalary));
                cells.push(
                  <span
                    key="status"
                    className={`badge ${employee.active ? "badge-green" : "badge-muted"}`}
                  >
                    {employee.active ? "Active" : "Inactive"}
                  </span>,
                );
                cells.push(
                  user.role === "MAIN_ADMIN" && employee.active ? (
                    <button
                      key="deactivate"
                      className="button button-small"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Deactivate ${employee.fullName}? Historical attendance and salary will remain.`,
                          )
                        )
                          void mutate(
                            `/api/employees/${employee._id}`,
                            { active: false },
                            "PATCH",
                          );
                      }}
                    >
                      Deactivate
                    </button>
                  ) : (
                    "—"
                  ),
                );
                return cells;
              })}
              empty="No employees match this search."
              page={page}
              pageSize={20}
              total={data.total ?? 0}
              onPageChange={setPage}
            />
          )}
        </div>
      );

    if (section === "advances")
      return (
        <div className="content-area">
          <PageHead
            title="Advances"
            description="Record staff advances. Approved items are deducted once during payroll generation."
            action={toolbar}
          />
          <Notice error={error} success={success} refreshing={refreshing} />
          {(data.pendingCount ?? 0) > 0 && (
            <div className="notice notice-warning pending-advance-notice">
              <Bell size={18} />
              <span>
                {data.pendingCount} advance(s) need approval. Review the
                employee, amount, and reference below.
              </span>
            </div>
          )}
          <div className="advance-controls-row">
            <button
              type="button"
              className="button button-primary advance-record-trigger"
              onClick={() => {
                setAdvanceOutletId(
                  selectedOutlet ||
                    data.outlets?.find((outlet) => outlet.active)?._id ||
                    "",
                );
                setAdvanceEmployeeId("");
                setIsAdvanceFormOpen(true);
              }}
            >
                <Plus size={16} /> Record advance
            </button>
            <label className="field advance-status-filter">
              <span>Filter advances</span>
              <select
                value={advanceStatus}
                onChange={(event) => {
                  setAdvanceStatus(
                    event.target.value as
                      | "ALL"
                      | "PENDING"
                      | "APPROVED"
                      | "REJECTED",
                  );
                  setPage(1);
                }}
              >
                <option value="ALL">All advances</option>
                <option value="PENDING">Pending approval</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </label>
          </div>
          {isAdvanceFormOpen && (
            <div className="advance-modal-backdrop">
              <section
                className="advance-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="record-advance-title"
              >
                <header className="advance-modal-heading">
                  <div>
                    <h2 id="record-advance-title">Record advance</h2>
                    <p>Add an advance to an employee’s record.</p>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Close record advance"
                    onClick={() => setIsAdvanceFormOpen(false)}
                  >
                    <X size={18} />
                  </button>
                </header>
                <form
                  className="form-grid"
                  onSubmit={(event) => submit(event, "/api/advances")}
                >
                <label className="field">
                  <span>Outlet</span>
                  <select
                    name="outletId"
                    value={advanceOutletId}
                    onChange={(event) => {
                      setAdvanceOutletId(event.target.value);
                      setAdvanceEmployeeId("");
                    }}
                    required
                  >
                    <option value="" disabled>
                      Select outlet
                    </option>
                    {activeOutlets.map((outlet) => (
                      <option key={outlet._id} value={outlet._id}>
                        {outlet.code} · {outlet.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Employee</span>
                  <select
                    name="employeeId"
                    value={advanceEmployeeId}
                    onChange={(event) =>
                      setAdvanceEmployeeId(event.target.value)
                    }
                    required
                    disabled={!advanceOutletId}
                  >
                    <option value="" disabled>
                      {advanceOutletId
                        ? "Select employee"
                        : "Select outlet first"}
                    </option>
                    {(data.employees ?? [])
                      .filter(
                        (employee: Employee) =>
                          employee.outletId === advanceOutletId,
                      )
                      .map((employee: Employee) => (
                      <option key={employee._id} value={employee._id}>
                        {employee.employeeCode} · {employee.fullName} ·{" "}
                        {data.outlets?.find(
                          (outlet: Outlet) =>
                            outlet._id === employee.outletId,
                        )?.code ?? "Outlet"}
                      </option>
                      ))}
                  </select>
                </label>
                <Field
                  label="Date"
                  name="date"
                  type="date"
                  defaultValue={date}
                  required
                />
                <Field
                  label="Amount (INR)"
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                />
                <Field label="Given by" name="givenBy" required />
                <Field
                  label="Reference / transaction"
                  name="reference"
                  required
                />
                <Field label="Notes" name="notes" />
                <div className="form-actions">
                  <button
                    className="button button-primary"
                    disabled={busy || !activeOutlets.length}
                  >
                    <Plus size={16} /> Save advance
                  </button>
                </div>
                </form>
              </section>
            </div>
          )}
          {loading ? (
            <Loading />
          ) : (
            <DataTable
              headers={[
                "Date",
                "Employee",
                "Amount",
                "Given by",
                "Reference",
                "Status",
                "Actions",
              ]}
              rows={(data.advances ?? []).map((item) => [
                item.date,
                item.employeeName ?? String(item.employeeId),
                currency(item.amount),
                item.givenBy,
                item.reference,
                <span
                  key="status"
                  className={`badge ${item.status === "APPROVED" ? "badge-green" : item.status === "REJECTED" ? "badge-red" : "badge-gold"}`}
                >
                  {item.status === "APPROVED"
                    ? "Approved"
                    : item.status === "REJECTED"
                      ? "Rejected"
                      : "Pending"}
                </span>,
                <div key="actions" className="toolbar">
                  {!item.payrollRecordId &&
                    user.permissions.includes("advances.write") &&
                    (item.status === "PENDING" || user.role === "MAIN_ADMIN") && (
                      <AdvanceEdit
                        item={item}
                        busy={busy}
                        userRole={user.role}
                        onSave={(input) =>
                          mutate(`/api/advances/${item._id}`, input, "PATCH")
                        }
                      />
                    )}
                  {(item.status === "PENDING" ||
                    item.status === "APPROVED") &&
                    !item.payrollRecordId &&
                    user.permissions.includes("advances.approve") && (
                      <>
                        {item.status === "PENDING" && (
                          <button
                            className="button button-small advance-approve-button"
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Approve this advance for one-time payroll deduction?",
                                )
                              )
                                void mutate(
                                  `/api/advances/${item._id}`,
                                  { action: "APPROVE" },
                                  "PATCH",
                                );
                            }}
                          >
                            <Check size={14} /> Approve
                          </button>
                        )}
                        <button
                          className="button button-small advance-reject-button"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                item.status === "APPROVED"
                                  ? "Mark this approved advance as rejected? It will no longer be included in payroll."
                                  : "Reject this advance? It will not be included in payroll.",
                              )
                            )
                              void mutate(
                                `/api/advances/${item._id}`,
                                { action: "REJECT" },
                                "PATCH",
                              );
                          }}
                        >
                          <X size={14} />{" "}
                          {item.status === "APPROVED"
                            ? "Mark as rejected"
                            : "Reject"}
                        </button>
                      </>
                    )}
                  {item.status === "REJECTED" &&
                    user.permissions.includes("advances.approve") && (
                      <>
                        <button
                          className="button button-small advance-restore-button"
                          disabled={busy || Boolean(item.payrollRecordId)}
                          title="Restore to pending approvals"
                          onClick={() =>
                            void mutate(
                              `/api/advances/${item._id}`,
                              { action: "RESTORE" },
                              "PATCH",
                            )
                          }
                        >
                          Restore
                        </button>
                        <button
                          className="button button-small advance-approve-button"
                          disabled={busy || Boolean(item.payrollRecordId)}
                          title="Restore and approve for payroll deduction"
                          onClick={() => {
                            if (
                              window.confirm(
                                "Restore and approve this advance for one-time payroll deduction?",
                              )
                            )
                              void mutate(
                                `/api/advances/${item._id}`,
                                { action: "RESTORE_AND_APPROVE" },
                                "PATCH",
                              );
                          }}
                        >
                          <Check size={14} /> Restore &amp; approve
                        </button>
                      </>
                    )}
                  {item.payrollRecordId && (
                    <span className="sub-cell">Claimed</span>
                  )}
                </div>,
              ])}
              empty="No advances recorded for this period."
              page={page}
              pageSize={25}
              total={data.total ?? 0}
              onPageChange={setPage}
            />
          )}
        </div>
      );

    if (section === "loans") {
      let loanSchedule: ReturnType<typeof loanScheduleSummary> | undefined;
      try {
        loanSchedule = loanScheduleSummary({
          amount: Number(loanFormAmount),
          method: loanFormMethod,
          startMonth: loanFormStartMonth,
          monthlyDeductionAmount: Number(loanFormMonthlyAmount),
          installmentCount: Number(loanFormInstallmentCount),
          endMonth: loanFormEndMonth,
        });
      } catch {
        loanSchedule = undefined;
      }
      const visibleLoans = (data.loans ?? []).filter((loan: LoanView) => {
        const status =
          loan.status ??
          (loan.outstandingAmount > 0 ? "ACTIVE" : "COMPLETED");
        const statusMatches =
          loanStatusFilter === "ALL" ||
          (loanStatusFilter === "ONGOING" && status === "ACTIVE") ||
          status === loanStatusFilter;
        const query = loanSearch.trim().toLowerCase();
        const searchMatches =
          !query ||
          [loan.employeeName, loan.employeeCode, loan.outletCode]
            .filter(Boolean)
            .some((value) => value!.toLowerCase().includes(query));
        return statusMatches && searchMatches;
      });
      async function showLoanHistory(loan: LoanView) {
        try {
          const history = await request<{
            installments: Array<Record<string, unknown>>;
            transactions: Array<Record<string, unknown>>;
          }>(`/api/loans/${loan._id}/actions`);
          setLoanHistory({ employeeName: loan.employeeName ?? loan.employeeCode ?? "", ...history });
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Unable to load repayment history.");
        }
      }
      function openLoanAction(loan: LoanView, action: LoanActionName) {
        setLoanAction({ loan, action });
      }
      async function submitLoanAction(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!loanAction) return;
        const values = new FormData(event.currentTarget);
        const reason = String(values.get("reason") ?? "").trim();
        const reference = String(values.get("reference") ?? "").trim();
        const { loan, action } = loanAction;
        const payload: Record<string, unknown> = { action, reason };
        let successMessage = "Loan action recorded.";
        if (action === "SKIP") {
          payload.payrollMonth = month;
          successMessage = "Installment skipped.";
        } else if (action === "PAUSE" || action === "RESUME") {
          if (action === "RESUME")
            payload.effectiveMonth = String(values.get("effectiveMonth") ?? "");
          successMessage = action === "PAUSE" ? "Loan paused." : "Loan resumed.";
        } else if (action === "ADJUST") {
          payload.direction = String(values.get("direction") ?? "");
          payload.amount = Number(values.get("amount"));
          payload.transactionDate = String(values.get("transactionDate") ?? "");
          payload.reference = reference;
          successMessage = "Loan balance adjustment recorded.";
        } else if (action === "CLOSE") {
          payload.closureType = String(values.get("closureType") ?? "");
          payload.transactionDate = String(values.get("transactionDate") ?? "");
          payload.reference = reference;
          if (payload.closureType === "EXTERNAL_SETTLEMENT")
            payload.amount = Number(values.get("amount"));
          successMessage =
            payload.closureType === "EXTERNAL_SETTLEMENT" &&
            Number(payload.amount) < loan.outstandingAmount
              ? "Partial settlement recorded; the loan remains ongoing."
              : "Loan completion recorded.";
        } else {
          payload.payrollMonth = month;
          payload.transactionDate = String(values.get("transactionDate") ?? "");
          successMessage = "Loan installment reversed.";
        }
        if (
          await mutate(
            `/api/loans/${loan._id}/actions`,
            payload,
            "POST",
            successMessage,
          )
        )
          setLoanAction(null);
      }
      return (
        <div className="content-area">
          <PageHead
            className="loan-page-head"
            title="Employee loans"
            description="Track loan balances and monthly payroll deductions."
            action={<div className="loan-page-head-actions">{toolbar}</div>}
          />
          <Notice error={error} success={success} refreshing={refreshing} />
          <section className="panel form-panel">
            <form
              className="form-grid"
              onSubmit={(event) =>
                void submit(event, "/api/loans", "POST", async () => {
                  setLoanFormAmount("");
                  setLoanFormMonthlyAmount("");
                  setLoanFormMethod("FIXED_AMOUNT");
                  setLoanFormInstallmentCount("10");
                  setLoanFormStartMonth(month);
                  setLoanFormEndMonth(month);
                  await reload();
                })
              }
            >
              <label className="field">
                <span>Outlet</span>
                <select
                  name="outletId"
                  value={loanOutletId}
                  onChange={(event) => {
                    setLoanOutletId(event.target.value);
                    setLoanEmployeeId("");
                  }}
                  required
                >
                  <option value="">All outlets</option>
                  {activeOutlets.map((outlet) => (
                    <option key={outlet._id} value={outlet._id}>
                      {outlet.code} · {outlet.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Employee</span>
                <select
                  name="employeeId"
                  value={loanEmployeeId}
                  onChange={(event) => {
                    const employeeId = event.target.value;
                    setLoanEmployeeId(employeeId);
                    const employee = data.employees?.find(
                      (item) => item._id === employeeId,
                    );
                    if (employee) setLoanOutletId(employee.outletId);
                  }}
                  required
                >
                  <option value="">Select employee</option>
                  {(data.employees ?? [])
                    .filter(
                      (employee) =>
                        !loanOutletId || employee.outletId === loanOutletId,
                    )
                    .map((employee) => (
                      <option key={employee._id} value={employee._id}>
                        {employee.employeeCode} · {employee.fullName} ·{" "}
                        {data.outlets?.find(
                          (outlet: Outlet) => outlet._id === employee.outletId,
                        )?.code ?? "Outlet"}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span>Original loan amount (INR)</span>
                <input
                  name="totalAmount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={loanFormAmount}
                  onChange={(event) => setLoanFormAmount(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>Repayment method</span>
                <select
                  name="repaymentMethod"
                  value={loanFormMethod}
                  onChange={(event) =>
                    setLoanFormMethod(
                      event.target.value as
                        | "FIXED_AMOUNT"
                        | "FIXED_INSTALLMENTS"
                        | "DATE_RANGE",
                    )
                  }
                >
                  <option value="FIXED_AMOUNT">Fixed monthly deduction</option>
                  <option value="FIXED_INSTALLMENTS">Fixed number of installments</option>
                  <option value="DATE_RANGE">Start and end month</option>
                </select>
              </label>
              {loanFormMethod === "FIXED_AMOUNT" ? (
                <label className="field">
                  <span>Monthly deduction (INR)</span>
                  <input
                    name="monthlyDeductionAmount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={loanFormMonthlyAmount}
                    onChange={(event) =>
                      setLoanFormMonthlyAmount(event.target.value)
                    }
                    required
                  />
                </label>
              ) : (
                <>
                  <label className="field">
                    <span>
                      {loanFormMethod === "FIXED_INSTALLMENTS"
                        ? "Number of installments"
                        : "Monthly deduction (INR, calculated)"}
                    </span>
                    {loanFormMethod === "FIXED_INSTALLMENTS" ? (
                      <input
                        name="installmentCount"
                        type="number"
                        min="1"
                        max="600"
                        step="1"
                        value={loanFormInstallmentCount}
                        onChange={(event) =>
                          setLoanFormInstallmentCount(event.target.value)
                        }
                        required
                      />
                    ) : (
                      <input
                        type="number"
                        value={loanSchedule?.monthlyDeductionAmount ?? ""}
                        readOnly
                      />
                    )}
                  </label>
                  <input
                    type="hidden"
                    name="monthlyDeductionAmount"
                    value={
                      loanFormMethod === "FIXED_INSTALLMENTS"
                        ? loanSchedule?.monthlyDeductionAmount ?? ""
                        : loanSchedule?.monthlyDeductionAmount ?? ""
                    }
                  />
                  {loanFormMethod === "DATE_RANGE" && (
                    <label className="field">
                      <span>Final deduction month</span>
                      <input
                        name="deductionEndMonth"
                        type="month"
                        min={loanFormStartMonth}
                        value={loanFormEndMonth}
                        onChange={(event) =>
                          setLoanFormEndMonth(event.target.value)
                        }
                        required
                      />
                    </label>
                  )}
                </>
              )}
              <label className="field">
                <span>Deduction start month</span>
                <input
                  name="deductionStartMonth"
                  type="month"
                  value={loanFormStartMonth}
                  onChange={(event) => setLoanFormStartMonth(event.target.value)}
                  required
                />
              </label>
              {loanSchedule && (
                <p className="sub-cell">
                  {loanSchedule.installmentCount} installments ·{" "}
                  {currency(loanSchedule.monthlyDeductionAmount)} per month ·
                  expected completion {loanSchedule.endMonth}
                  {loanSchedule.installmentCount > 1
                    ? " (final installment is adjusted to the exact balance)"
                    : ""}
                </p>
              )}
              <Field label="Notes" name="notes" />
              <div className="form-actions">
                <button
                  className="button button-primary"
                  disabled={busy || !(data.outlets ?? []).length}
                >
                  <HandCoins size={16} /> Save loan
                </button>
              </div>
            </form>
          </section>
          <div className="toolbar loan-filter-toolbar">
            <label className="field">
              <span>Payroll month</span>
              <input
                type="month"
                aria-label="Selected payroll month for loan actions"
                value={month}
                onChange={(event) => {
                  setMonth(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label className="field loan-status-filter">
              <span>Loan status</span>
              <select
                aria-label="Filter loans by status"
                value={loanStatusFilter}
                onChange={(event) => {
                  setLoanStatusFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="ALL">All loans</option>
                <option value="ONGOING">Ongoing</option>
                <option value="COMPLETED">Completed</option>
                <option value="PAUSED">Paused</option>
              </select>
            </label>
            <label className="field loan-search-filter">
              <span>Search</span>
              <input
                type="search"
                aria-label="Search loans"
                placeholder="Employee or outlet"
                value={loanSearch}
                onChange={(event) => {
                  setLoanSearch(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            {user.permissions.includes("reports.export") &&
              user.permissions.includes("salary.read") && (
                <div className="loan-export-actions" aria-label="Export loans">
                  {(["xlsx", "csv"] as const).map((format) => (
                <button
                  key={format}
                  type="button"
                  className="button button-secondary"
                  disabled={loading}
                  onClick={() => {
                    const params = new URLSearchParams({
                      type: "loans",
                      format,
                      from: `${month}-01`,
                      to: `${month}-${String(getMonthDatesLocal(month)).padStart(2, "0")}`,
                    });
                    if (selectedOutlet) params.set("outletId", selectedOutlet);
                    void downloadReport(
                      `/api/reports/export?${params.toString()}`,
                      format,
                    ).catch((caught) =>
                      setError(
                        caught instanceof Error
                          ? caught.message
                          : "Unable to export loan records.",
                      ),
                    );
                  }}
                >
                  {format === "xlsx" ? <FileSpreadsheet size={16} /> : <FileText size={16} />}
                  {format === "xlsx" ? "Excel" : "CSV"}
                </button>
              ))}
                </div>
              )}
          </div>
          {loading ? (
            <Loading />
          ) : (
            <DataTable
              headers={[
                "Employee",
                "Outlet",
                "Original loan",
                "Remaining balance",
                "Monthly deduction",
                "Notes",
                "Actions",
              ]}
              rows={visibleLoans
                .slice((page - 1) * 25, page * 25)
                .map((loan: LoanView) => [
                <span key="employee">
                  <strong>{loan.employeeName}</strong>
                  <span className="sub-cell">{loan.employeeCode}</span>
                  <span className="sub-cell">
                    Repaid: {currency(loan.repaidAmount ?? 0)}
                  </span>
                  {loan.outstandingAmount > 0 &&
                    loan.monthlyDeductionAmount &&
                    loan.deductionStartMonth && (
                      <span className="sub-cell">
                        Expected completion:{" "}
                        {expectedCompletionMonth({
                          balance: loan.outstandingAmount,
                          monthlyDeductionAmount: loan.monthlyDeductionAmount,
                          startMonth:
                            loan.deductionStartMonth > month
                              ? loan.deductionStartMonth
                              : month,
                        }) ?? "—"}
                      </span>
                    )}
                  <span
                    className={`badge ${
                      loan.status === "PAUSED"
                        ? "badge-gold"
                        : loan.status === "COMPLETED" ||
                            (loan.status === undefined &&
                              loan.outstandingAmount <= 0)
                          ? "badge-muted"
                          : "badge-green"
                    }`}
                  >
                    {loan.status === "ACTIVE" ||
                    (!loan.status && loan.outstandingAmount > 0)
                      ? "ONGOING"
                      : loan.status ?? "COMPLETED"}
                  </span>
                  <span className="sub-cell">
                      {loan.currentPayrollMonth}:{" "}
                      {loan.currentInstallmentStatus ?? "NOT_DUE"}
                      {loan.currentInstallmentStatus === "POSTED"
                        ? ` · ${currency(loan.currentActualDeduction)}`
                        : loan.currentInstallmentStatus === "SCHEDULED"
                          ? ` · ${currency(loan.currentScheduledDeduction)}`
                          : ""}
                  </span>
                </span>,
                loan.outletCode ?? "",
                currency(loan.totalAmount),
                currency(loan.outstandingAmount),
                currency(loan.monthlyDeductionAmount ?? 0),
                loan.notes || "—",
                <div key="actions" className="loan-row-actions">
                  <select
                    className="loan-action-select"
                    aria-label={`Actions for ${loan.employeeName ?? loan.employeeCode}`}
                    value=""
                    disabled={busy}
                    onChange={(event) => {
                      const action = event.target.value;
                      event.currentTarget.value = "";
                      if (action === "EDIT") setLoanToEdit(loan);
                      else if (action === "HISTORY")
                        void showLoanHistory(loan);
                      else if (action === "SKIP")
                        openLoanAction(loan, "SKIP");
                      else if (action === "PAUSE")
                        openLoanAction(loan, "PAUSE");
                      else if (action === "RESUME")
                        openLoanAction(loan, "RESUME");
                      else if (action === "ADJUST")
                        openLoanAction(loan, "ADJUST");
                      else if (action === "CLOSE")
                        openLoanAction(loan, "CLOSE");
                      else if (action === "REVERSE")
                        openLoanAction(loan, "REVERSE");
                    }}
                  >
                    <option value="" disabled>
                      Choose action…
                    </option>
                    <option
                      value="EDIT"
                      disabled={
                        loan.status === "COMPLETED" ||
                        loan.outstandingAmount <= 0
                      }
                    >
                      Edit repayment terms
                    </option>
                    {loan.status !== "COMPLETED" &&
                      loan.outstandingAmount > 0 && (
                        <>
                          {loan.status !== "PAUSED" && (
                            <option value="SKIP">Skip this month</option>
                          )}
                          <option
                            value={
                              loan.status === "PAUSED" ? "RESUME" : "PAUSE"
                            }
                          >
                            {loan.status === "PAUSED"
                              ? "Resume loan"
                              : "Pause loan"}
                          </option>
                          <option value="ADJUST">Adjust balance</option>
                          <option value="CLOSE">Mark as completed</option>
                        </>
                      )}
                    {loan.currentInstallmentStatus === "POSTED" && (
                      <option value="REVERSE">Reverse posted installment</option>
                    )}
                    <option value="HISTORY">View repayment history</option>
                  </select>
                </div>,
                ])}
              empty="No loans recorded."
              page={page}
              pageSize={25}
              total={visibleLoans.length}
              onPageChange={setPage}
            />
          )}
          {loanAction && (
            <LoanActionDialog
              loan={loanAction.loan}
              action={loanAction.action}
              payrollMonth={month}
              busy={busy}
              onClose={() => setLoanAction(null)}
              onSubmit={submitLoanAction}
            />
          )}
          {loanToEdit && (
            <div className="advance-modal-backdrop">
              <section
                className="advance-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="loan-edit-title"
              >
                <header className="advance-modal-heading">
                  <div>
                    <h2 id="loan-edit-title">Edit repayment terms</h2>
                    <p>
                      {loanToEdit.employeeName} · {loanToEdit.employeeCode} ·{" "}
                      {loanToEdit.outletCode}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Close loan editor"
                    onClick={() => setLoanToEdit(null)}
                  >
                    <X size={16} />
                  </button>
                </header>
                <form
                  className="advance-edit-form"
                  onSubmit={(event) =>
                    void submit(
                      event,
                      `/api/loans/${loanToEdit._id}`,
                      "PATCH",
                      async () => {
                        await reload();
                        setLoanToEdit(null);
                      },
                    )
                  }
                >
                  <label className="field">
                    <span>Remaining loan balance (INR)</span>
                    <input
                      type="number"
                      value={loanToEdit.outstandingAmount}
                      readOnly
                    />
                  </label>
                  <Field
                    id="loan-edit-monthlyDeductionAmount"
                    label="Monthly deduction (INR)"
                    name="monthlyDeductionAmount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    defaultValue={String(
                      loanToEdit.monthlyDeductionAmount ?? 0,
                    )}
                    required
                    infoText="This amount is deducted from net salary each month. The final installment is capped at the remaining loan balance."
                  />
                  <label className="field">
                    <span>Repayment method</span>
                    <select
                      name="repaymentMethod"
                      defaultValue={loanToEdit.repaymentMethod ?? "FIXED_AMOUNT"}
                    >
                      <option value="FIXED_AMOUNT">Fixed monthly deduction</option>
                      <option value="FIXED_INSTALLMENTS">Fixed number of installments</option>
                      <option value="DATE_RANGE">Start and end month</option>
                    </select>
                  </label>
                  <Field
                    id="loan-edit-installmentCount"
                    label="Number of installments (used for fixed installment method)"
                    name="installmentCount"
                    type="number"
                    min="1"
                    max="600"
                    step="1"
                    defaultValue={String(loanToEdit.installmentCount ?? 10)}
                  />
                  <Field
                    id="loan-edit-deductionEndMonth"
                    label="Final deduction month (used for date-range method)"
                    name="deductionEndMonth"
                    type="month"
                    defaultValue={
                      loanToEdit.deductionEndMonth ??
                      loanToEdit.deductionStartMonth ??
                      month
                    }
                  />
                  <Field
                    id="loan-edit-deductionStartMonth"
                    label="Deduction start month"
                    name="deductionStartMonth"
                    type="month"
                    defaultValue={
                      loanToEdit.deductionStartMonth &&
                      loanToEdit.deductionStartMonth > month
                        ? loanToEdit.deductionStartMonth
                        : month
                    }
                    required
                  />
                  <Field
                    id="loan-edit-notes"
                    label="Notes"
                    name="notes"
                    defaultValue={loanToEdit.notes}
                  />
                  <div className="form-actions loan-edit-actions">
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() => setLoanToEdit(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="button button-primary"
                      disabled={busy}
                    >
                      Save loan
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}
        </div>
      );
    }

    if (section === "salary") {
      const payrollEmployees = data.payrollEmployees ?? [];
      return (
        <div className="content-area">
          <PageHead
            title="Monthly salary"
            description="Generate, review, adjust, approve and record payroll payments."
            action={
              <div className="toolbar">
                <input
                  type="month"
                  value={month}
                  onChange={(event) => {
                    setSalaryGenerateEmployee(null);
                    setMonth(event.target.value);
                  }}
                  aria-label="Payroll month"
                />
                {toolbar}
                {user.permissions.includes("reports.export") &&
                  user.permissions.includes("salary.read") && (
                    (["xlsx", "csv"] as const).map((format) => (
                      <button
                        key={format}
                        className="button"
                        disabled={loading}
                        title={
                          format === "csv"
                            ? "CSV contains plain tabular data; use Excel for formatting."
                            : "Download a formatted Excel workbook."
                        }
                        onClick={() => {
                          const params = new URLSearchParams({
                            type: "salary",
                            format,
                            from: `${month}-01`,
                            to: `${month}-${String(getMonthDatesLocal(month)).padStart(2, "0")}`,
                          });
                          if (selectedOutlet)
                            params.set("outletId", selectedOutlet);
                          void downloadReport(
                            `/api/reports/export?${params.toString()}`,
                            format,
                          ).catch((caught) =>
                            setError(
                              caught instanceof Error
                                ? caught.message
                                : `Unable to export salary ${format.toUpperCase()}.`,
                            ),
                          );
                        }}
                      >
                        {format === "xlsx" ? (
                          <FileSpreadsheet size={16} />
                        ) : (
                          <FileText size={16} />
                        )}
                        {format === "xlsx" ? "Excel" : "CSV"}
                      </button>
                    ))
                )}
              </div>
            }
          />
          <Notice error={error} success={success} refreshing={refreshing} />
          {loading ? (
            <Loading />
          ) : (
            <>
            <DataTable
              headers={[
                "Employee",
                "Period",
                "Days P / A / HD / WO",
                "Days filled",
                "Gross",
                "Advances",
                "Employee ESI",
                "Employee PF (deduction)",
                "Employer PF (tracked)",
                "Original loan",
                "Remaining loan",
                "Scheduled deduction",
                "Actual deduction",
                "Net payable",
                "Status",
                "Actions",
              ]}
              rows={[
                ...(data.records ?? []).map((record: SalaryView) => {
                const loanSnapshot = record.inputSnapshot.loans ?? [];
                const loanTotal = (key: "originalAmount" | "closingBalance" | "scheduledDeduction" | "actualDeduction") =>
                  loanSnapshot.reduce((sum, loan) => sum + loan[key], 0);
                return [
                <div key="employee">
                  <strong>{record.inputSnapshot.employee.fullName}</strong>
                  <span className="sub-cell">
                    {record.inputSnapshot.employee.employeeCode}
                  </span>
                  {record.inputSnapshot.employee.monthlyBaseSalary !==
                    undefined && (
                    <span className="sub-cell">
                      Monthly base:{" "}
                      {currency(
                        record.inputSnapshot.employee.monthlyBaseSalary,
                      )}
                    </span>
                  )}
                  <details className="salary-breakdown">
                    <summary>Calculation breakdown</summary>
                    <dl>
                      <dt>Daily rate</dt>
                      <dd>{currency(record.calculation.dailyRate)}</dd>
                      <dt>Half-day deduction</dt>
                      <dd>
                        {currency(
                          record.calculation.halfDayDeduction ??
                            (record.calculation.dailyRate *
                              record.calculation.halfDays) /
                              2,
                        )}
                      </dd>
                      <dt>Paid day units</dt>
                      <dd>{record.calculation.payableDayUnits}</dd>
                      <dt>Paid absences</dt>
                      <dd>{record.calculation.paidAbsenceDays}</dd>
                      <dt>Paid week-offs</dt>
                      <dd>{record.calculation.weekOffs}</dd>
                      <dt>Overtime / allowances</dt>
                      <dd>
                        {currency(record.calculation.overtime)} /{" "}
                        {currency(record.calculation.allowances)}
                      </dd>
                      <dt>Other deductions</dt>
                      <dd>{currency(record.calculation.otherDeductions)}</dd>
                      <dt>Payroll state</dt>
                      <dd>
                        {record.status}
                        {record.paidAt
                          ? ` · paid ${formatDate(record.paidAt)}`
                          : ""}
                      </dd>
                      {loanSnapshot.map((loan) => (
                        <Fragment key={loan.loanId}>
                          <dt>
                            Loan {loan.payrollMonth ?? record.month} · {loan.status}
                          </dt>
                          <dd>
                            Original {currency(loan.originalAmount)} · opening{" "}
                            {currency(loan.openingBalance)} · scheduled{" "}
                            {currency(loan.scheduledDeduction)} · actual{" "}
                            {currency(loan.actualDeduction)} · closing{" "}
                            {currency(loan.closingBalance)}
                          </dd>
                        </Fragment>
                      ))}
                    </dl>
                  </details>
                </div>,
                record.periodStart && record.periodEnd
                  ? `${formatDate(record.periodStart)} – ${formatDate(record.periodEnd)}`
                  : "Full month (legacy)",
                `${record.calculation.presentDays} / ${record.calculation.absentDays} / ${record.calculation.halfDays} / ${record.calculation.weekOffs}`,
                record.calculation.presentDays +
                  record.calculation.absentDays +
                  record.calculation.halfDays +
                  record.calculation.weekOffs,
                currency(record.calculation.grossEarnings),
                currency(record.calculation.advances),
                currency(record.calculation.esi ?? 0),
                currency(record.calculation.employeePf),
                currency(record.calculation.employerPf ?? 0),
                loanSnapshot.length ? currency(loanTotal("originalAmount")) : "—",
                loanSnapshot.length ? currency(loanTotal("closingBalance")) : "—",
                loanSnapshot.length ? currency(loanTotal("scheduledDeduction")) : "—",
                loanSnapshot.length ? currency(loanTotal("actualDeduction")) : "—",
                <strong key="net">
                  {currency(record.calculation.netPayable)}
                </strong>,
                <span
                  key="status"
                  className={`badge ${record.status === "PAID" ? "badge-green" : record.status === "APPROVED" ? "badge-gold" : "badge-muted"}`}
                >
                  {record.status}
                </span>,
                <SalaryActions
                  key={record._id}
                  record={record}
                  permissions={user.permissions}
                  busy={busy}
                  employee={payrollEmployees.find(
                    (employee) =>
                      employee.latestPayrollRecordId === record._id,
                  )}
                  onGenerate={() =>
                    setSalaryGenerateEmployee(
                      payrollEmployees.find(
                        (employee) =>
                          employee.latestPayrollRecordId === record._id,
                      ) ?? null,
                    )
                  }
                  onManage={() => setSalaryManageRecord(record)}
                />,
                ];
                }),
                ...payrollEmployees
                  .filter((employee) => !employee.payrollRecordId)
                  .map((employee) => [
                    <div key={employee._id}>
                      <strong>{employee.fullName}</strong>
                      <span className="sub-cell">
                        {employee.employeeCode} · {employee.designation} ·{" "}
                        {employee.outletCode}
                      </span>
                      <span className="sub-cell">
                        Monthly base: {currency(employee.monthlyBaseSalary)}
                      </span>
                      {employee.suggestedPeriodEnd ? (
                        <span className="sub-cell">
                          Ready through {employee.suggestedPeriodEnd}
                        </span>
                      ) : (
                        <span className="sub-cell">
                          Submit attendance for the next uncovered dates to generate payroll.
                        </span>
                      )}
                      {employee.outstandingLoanTotal > 0 && (
                        <span className="sub-cell">
                          Outstanding loan:{" "}
                          {currency(employee.outstandingLoanTotal)}
                        </span>
                      )}
                    </div>,
                    "—",
                    `${employee.attendance.P} / ${employee.attendance.A} / ${employee.attendance.HD} / ${employee.attendance.WO}`,
                    employee.attendance.P +
                      employee.attendance.A +
                      employee.attendance.HD +
                      employee.attendance.WO,
                    "—",
                    currency(employee.approvedAdvanceTotal),
                    currency(0),
                    currency(0),
                    currency(0),
                    currency(0),
                    "—",
                    <span key="status" className="badge badge-muted">
                      Not generated
                    </span>,
                    user.permissions.includes("salary.generate") &&
                    employee.suggestedPeriodEnd &&
                    !employee.hasLegacyPayroll ? (
                      <button
                        key="generate"
                        className="button button-small"
                        disabled={busy}
                        onClick={() => setSalaryGenerateEmployee(employee)}
                      >
                        <Plus size={14} /> Generate
                      </button>
                    ) : (
                      "—"
                    ),
                  ]),
              ]}
              empty="No eligible employees or payroll records for this month."
            />
            {salaryGenerateEmployee && (
              <SalaryGenerateModal
                key={`${salaryGenerateEmployee._id}:${month}`}
                employee={salaryGenerateEmployee}
                month={month}
                canApprove={user.permissions.includes("salary.approve")}
                canDeductLoan={user.role === "MAIN_ADMIN"}
                busy={busy}
                onClose={() => setSalaryGenerateEmployee(null)}
                onSubmit={async (payload) => {
                  const ok = await mutate("/api/payroll", payload);
                  if (ok) setSalaryGenerateEmployee(null);
                }}
              />
            )}
            {salaryManageRecord && (
              <SalaryManageModal
                key={`${salaryManageRecord._id}:${salaryManageRecord.updatedAt ?? salaryManageRecord.status}`}
                record={salaryManageRecord}
                isMainAdmin={user.role === "MAIN_ADMIN"}
                permissions={user.permissions}
                busy={busy}
                onClose={() => setSalaryManageRecord(null)}
                onAction={async (action) => {
                  const ok = await mutate(
                    `/api/payroll/${salaryManageRecord._id}`,
                    action,
                  );
                  if (ok) setSalaryManageRecord(null);
                  return ok;
                }}
              />
            )}
            </>
          )}
        </div>
      );
    }

    if (section === "outlets")
      return (
        <div className="content-area">
          <PageHead
            title="Outlets"
            description="Manage your outlet details and control active attendance operations."
            action={toolbar}
          />
          <Notice error={error} success={success} refreshing={refreshing} />
          {user.role === "MAIN_ADMIN" && (
            <details className="panel form-panel outlet-create-panel">
              <summary>
                <Plus size={17} /> Add new outlet
              </summary>
              <form
                key={nextAvailableOutletNumber(data.outlets ?? [])}
                className="form-grid"
                onSubmit={(event) => submit(event, "/api/outlets")}
              >
                <Field
                  label="Outlet number"
                  name="outletNumber"
                  type="number"
                  min="1"
                  max="99"
                  step="1"
                  defaultValue={String(nextAvailableOutletNumber(data.outlets ?? []))}
                  required
                  infoText="Choose an outlet number from 1 to 99. The next unused number is selected by default; numbers already assigned to existing outlets cannot be reused."
                />
                <Field label="Outlet name" name="name" required />
                <Field label="Address" name="address" />
                <Field
                  label="City"
                  name="city"
                  defaultValue="Ahmedabad"
                  required
                />
                <Field label="Manager" name="managerName" />
                <Field label="Contact phone" name="contactPhone" />
                <label className="field">
                  <span>Status</span>
                  <select name="active" defaultValue="true">
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </label>
                <div className="form-actions">
                  <button
                    className="button button-primary"
                    type="submit"
                    disabled={busy}
                  >
                    <Plus size={16} /> {busy ? "Adding..." : "Add outlet"}
                  </button>
                </div>
              </form>
            </details>
          )}
          {loading ? (
            <Loading />
          ) : (
            <div className="outlet-grid">
              {(data.outlets ?? []).map((outlet: Outlet) => (
                <OutletCard
                  key={outlet._id}
                  outlet={outlet}
                  onSave={(fields) =>
                    mutate(
                      "/api/outlets",
                      { outletId: outlet._id, ...fields },
                      "PUT",
                    )
                  }
                  disabled={user.role !== "MAIN_ADMIN" || busy}
                />
              ))}
            </div>
          )}
        </div>
      );

    if (section === "access")
      return (
        <div className="content-area">
          <PageHead
            title="Access management"
            description="Create reusable designations with page permissions, then assign them to accounts and outlets."
          />
          <Notice error={error} success={success} refreshing={refreshing} />
          <DesignationManager
            designations={data.designations ?? []}
            onChanged={reload}
          />
          <details className="panel form-panel">
            <summary>
              <Plus size={17} /> Provision account
            </summary>
            <form
              className="form-grid"
              onSubmit={(event) => submit(event, "/api/users")}
            >
              <Field
                label="Account email"
                name="email"
                type="email"
                required
              />
              <Field label="Display name" name="name" required />
              <label className="field">
                <span>Initial password (at least 10 characters)</span>
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  required
                />
              </label>
              <label className="field">
                <span>Access profile</span>
                <select
                  name="accessProfile"
                  value={newAccountProfile}
                  onChange={(event) => setNewAccountProfile(event.target.value)}
                  required
                >
                  <option value="">Select Main Admin or a designation</option>
                  <option value="MAIN_ADMIN">Main Admin</option>
                  {(data.designations ?? []).map((designation) => (
                    <option
                      key={designation._id}
                      value={`designation:${designation._id}`}
                    >
                      Designation · {designation.name}
                    </option>
                  ))}
                </select>
              </label>
              {newAccountProfile !== "MAIN_ADMIN" && (
                <label className="field">
                  <span>Assigned outlet · choose one</span>
                  <select name="outletIds" required>
                    <option value="">Select outlet</option>
                    {activeOutlets.map((outlet) => (
                      <option key={outlet._id} value={outlet._id}>
                        {outlet.code} · {outlet.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {newAccountProfile.startsWith("designation:") && (
                <input
                  type="hidden"
                  name="designationId"
                  value={newAccountProfile.slice("designation:".length)}
                />
              )}
              <input type="hidden" name="active" value="true" />
              <div className="form-actions">
                <button className="button button-primary" disabled={busy}>
                  <Plus size={16} /> Provision user
                </button>
              </div>
            </form>
          </details>
          {loading ? (
            <Loading />
          ) : (
            <DataTable
              className="access-table"
              headers={[
                "Account",
                "Role",
                "Outlets",
                "Permissions",
                "Status",
                "Actions",
              ]}
              rows={(data.users ?? []).map((item: UserView) => [
                <span key="account">
                  <strong>{item.name}</strong>
                  <span className="sub-cell">{item.email}</span>
                </span>,
                item.designationName ??
                  (item.role === "MAIN_ADMIN"
                    ? "Main Admin"
                    : item.role === "CO_ADMIN"
                      ? "Co-admin"
                      : "Outlet User"),
                (item.outletIds ?? []).length,
                item.permissions?.join(", ") || "Role defaults",
                <span
                  key="status"
                  className={`badge ${item.active ? "badge-green" : "badge-muted"}`}
                >
                  {item.active ? "Active" : "Revoked"}
                </span>,
                <div
                  key={`${item._id}-${item.designationId ?? ""}-${item.permissions.join("|")}`}
                  className="user-action-buttons"
                >
                  <UserAccessControl
                    item={item}
                    outlets={activeOutlets}
                    designations={data.designations ?? []}
                    onSave={(input) =>
                      mutate(`/api/users/${item._id}`, input, "PATCH")
                    }
                  />
                  <UserPasswordControl item={item} />
                </div>,
              ])}
              empty="No provisioned users."
            />
          )}
        </div>
      );

    if (section === "reports")
      return <ReportsPanel outlets={activeOutlets} />;
    if (section === "activeLogs")
      return (
        <div className="content-area">
          <PageHead
            title="Active logs"
            description="Review the latest account and operations activity."
            action={toolbar}
          />
          <Notice error={error} success={success} refreshing={refreshing} />
          {loading ? (
            <Loading />
          ) : (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Recent activity</h2>
                  <p>Latest 50 changes visible to your account</p>
                </div>
              </div>
              <DataTable
                headers={["Time", "Actor", "Action", "Entity", "Reason"]}
                rows={(data.logs ?? []).map((log) => [
                  formatDateTime(log.at),
                  log.actorEmail,
                  log.action,
                  `${log.entityType} · ${log.entityId}`,
                  log.reason ?? "—",
                ])}
                empty="No audit activity recorded."
              />
            </section>
          )}
        </div>
      );
    if (section === "settings")
      return (
        <SettingsPanel
          data={data.settings}
          loading={loading}
          busy={busy}
          error={error}
          success={success}
          user={user}
          onSave={(settings) => mutate("/api/settings", settings, "PUT")}
        />
      );
    return null;
  }

  function AdvanceEdit({
    item,
    busy,
    userRole,
    onSave,
  }: {
    item: NonNullable<WorkspaceData["advances"]>[number];
    busy: boolean;
    userRole: UserRole;
    onSave: (input: Record<string, unknown>) => Promise<boolean>;
  }) {
    const [isOpen, setIsOpen] = useState(false);
    const editLimitReached =
      userRole === "OUTLET_USER" && (item.editCount ?? 0) >= 2;

    function submitEdit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      void onSave({
        employeeId: item.employeeId,
        outletId: item.outletId,
        date: values.get("date"),
        amount: Number(values.get("amount")),
        givenBy: values.get("givenBy"),
        reference: values.get("reference"),
        notes: values.get("notes"),
      });
    }
    return (
      <>
        <button
          type="button"
          className="button button-small"
          disabled={editLimitReached}
          title={
            editLimitReached
              ? "Outlet users can edit an advance no more than twice."
              : undefined
          }
          onClick={() => setIsOpen(true)}
        >
          Edit
        </button>
        {isOpen && (
          <div className="advance-modal-backdrop">
            <section
              className="advance-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby={`advance-edit-title-${item._id}`}
            >
              <header className="advance-modal-heading">
                <div>
                  <h2 id={`advance-edit-title-${item._id}`}>Edit advance</h2>
                  <p>
                    {item.employeeName ?? "Employee"} ·{" "}
                    {item.editCount ?? 0} edit(s) used
                  </p>
                </div>
                <button
                  type="button"
                  className="button button-small"
                  aria-label="Close edit advance"
                  onClick={() => setIsOpen(false)}
                >
                  <X size={16} />
                </button>
              </header>
              <form
                key={item.updatedAt ?? String(item.editCount ?? 0)}
                className="advance-edit-form"
                onSubmit={submitEdit}
              >
                <label className="field">
                  <span>Date</span>
                  <input name="date" type="date" defaultValue={item.date} required />
                </label>
                <label className="field">
                  <span>Amount (INR)</span>
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    defaultValue={item.amount}
                    required
                  />
                </label>
                <label className="field">
                  <span>Given by</span>
                  <input name="givenBy" defaultValue={item.givenBy} required />
                </label>
                <label className="field">
                  <span>Reference</span>
                  <input name="reference" defaultValue={item.reference} required />
                </label>
                <label className="field">
                  <span>Notes</span>
                  <input name="notes" defaultValue={item.notes ?? ""} />
                </label>
                <button className="button button-primary" disabled={busy}>
                  Save advance
                </button>
              </form>
            </section>
          </div>
        )}
      </>
    );
  }

  function SalaryActions({
    record,
    permissions,
    busy,
    employee,
    onGenerate,
    onManage,
  }: {
    record: SalaryView;
    permissions: Permission[];
    busy: boolean;
    employee?: PayrollEmployeeView;
    onGenerate: () => void;
    onManage: () => void;
  }) {
    return (
      <div className="salary-actions">
        <button
          className="button button-small"
          disabled={busy}
          onClick={onManage}
        >
          Manage
        </button>
        {record.status === "PAID" &&
          employee?.suggestedPeriodEnd &&
          !employee.hasLegacyPayroll &&
          permissions.includes("salary.generate") && (
            <button
              className="button button-small"
              disabled={busy}
              onClick={onGenerate}
              title="Generate payroll for the next uncovered attendance period"
            >
              <Plus size={14} /> Next period
            </button>
          )}
      </div>
    );
  }

  function SalaryManageModal({
    record,
    isMainAdmin,
    permissions,
    busy,
    onClose,
    onAction,
  }: {
    record: SalaryView;
    isMainAdmin: boolean;
    permissions: Permission[];
    busy: boolean;
    onClose: () => void;
    onAction: (action: Record<string, unknown>) => Promise<boolean>;
  }) {
    const [amounts, setAmounts] = useState({
      grossEarnings: record.calculation.grossEarnings,
      advances: record.calculation.advances,
      esi: record.calculation.esi ?? 0,
      employeePf: record.calculation.employeePf,
      employerPf: record.calculation.employerPf ?? 0,
      loanDeduction: record.calculation.loanDeduction ?? 0,
    });
    const [correctionReason, setCorrectionReason] = useState("");
    const [unpaidReason, setUnpaidReason] = useState("");
    const [adjustmentKind, setAdjustmentKind] = useState("OVERTIME");
    const [adjustmentLabel, setAdjustmentLabel] = useState("");
    const [adjustmentAmount, setAdjustmentAmount] = useState("");
    const [adjustmentReason, setAdjustmentReason] = useState("");
    const netPayable =
      Number(amounts.grossEarnings) +
      Number(record.calculation.overtime ?? 0) +
      Number(record.calculation.allowances ?? 0) -
      Number(amounts.advances) -
      Number(amounts.esi) -
      Number(amounts.employeePf) -
      Number(amounts.loanDeduction) -
      Number(record.calculation.otherDeductions ?? 0);

    async function submitPaidCorrection(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      await onAction({
        action: "EDIT_PAID",
        amounts,
        reason: correctionReason,
      });
    }

    async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      await onAction({
        action: "ADJUST",
        kind: adjustmentKind,
        label: adjustmentLabel,
        amount: Number(adjustmentAmount),
        reason: adjustmentReason,
      });
    }

    return (
      <div className="advance-modal-backdrop">
        <section
          className="advance-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`salary-manage-title-${record._id}`}
        >
          <header className="advance-modal-heading">
            <div>
              <h2 id={`salary-manage-title-${record._id}`}>Manage payroll</h2>
              <p>
                {record.inputSnapshot.employee.fullName} ·{" "}
                {record.inputSnapshot.employee.employeeCode} · {record.month} ·{" "}
                {record.status}
              </p>
            </div>
            <button
              type="button"
              className="button button-small"
              aria-label="Close payroll management"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </header>
          <div className="salary-manage-content">
            {record.status === "PAID" && (
              <>
                <form className="advance-edit-form" onSubmit={submitPaidCorrection}>
                  <p className="sub-cell">
                    Paid payroll corrections are limited to the main
                    administrator and are recorded in the audit log.
                  </p>
                  <AmountField
                    label="Gross (INR)"
                    value={Number(amounts.grossEarnings)}
                    disabled={!isMainAdmin}
                    onChange={(grossEarnings) =>
                      setAmounts((current) => ({ ...current, grossEarnings }))
                    }
                  />
                  <AmountField
                    label="Advances (INR)"
                    value={Number(amounts.advances)}
                    disabled={!isMainAdmin}
                    onChange={(advances) =>
                      setAmounts((current) => ({ ...current, advances }))
                    }
                  />
                  <AmountField
                    label="Employee ESI (INR)"
                    value={Number(amounts.esi)}
                    disabled={!isMainAdmin}
                    onChange={(esi) =>
                      setAmounts((current) => ({ ...current, esi }))
                    }
                  />
                  <AmountField
                    label="Employee PF deduction (INR)"
                    value={Number(amounts.employeePf)}
                    disabled={!isMainAdmin}
                    onChange={(employeePf) =>
                      setAmounts((current) => ({ ...current, employeePf }))
                    }
                  />
                  <AmountField
                    label="Employer PF tracked (INR)"
                    value={Number(amounts.employerPf)}
                    disabled={!isMainAdmin}
                    onChange={(employerPf) =>
                      setAmounts((current) => ({ ...current, employerPf }))
                    }
                  />
                  <AmountField
                    label="Loan deduction (INR)"
                    value={Number(amounts.loanDeduction)}
                    disabled
                    help="Use the loan installment reversal workflow to correct a posted repayment."
                    onChange={(loanDeduction) =>
                      setAmounts((current) => ({ ...current, loanDeduction }))
                    }
                  />
                  <div className="salary-preview-net">
                    <span>Net payable</span>
                    <strong>{currency(netPayable)}</strong>
                  </div>
                  {isMainAdmin && (
                    <>
                      <label className="field">
                        <span>Correction reason</span>
                        <input
                          value={correctionReason}
                          onChange={(event) =>
                            setCorrectionReason(event.target.value)
                          }
                          minLength={5}
                          maxLength={500}
                          required
                        />
                      </label>
                      <button
                        className="button button-primary"
                        disabled={busy}
                      >
                        Save paid payroll changes
                      </button>
                    </>
                  )}
                </form>
                {isMainAdmin && (
                  <div className="salary-manage-actions">
                    <label className="field">
                      <span>Reason for marking unpaid</span>
                      <input
                        value={unpaidReason}
                        onChange={(event) =>
                          setUnpaidReason(event.target.value)
                        }
                        minLength={5}
                        maxLength={500}
                      />
                    </label>
                    <button
                      className="button button-secondary"
                      disabled={busy || unpaidReason.trim().length < 5}
                      onClick={() =>
                        window.confirm(
                          "Mark this payroll payment as unpaid? It will return to Approved.",
                        ) &&
                        void onAction({
                          action: "UNPAY",
                          reason: unpaidReason,
                        })
                      }
                    >
                      Mark as unpaid
                    </button>
                  </div>
                )}
              </>
            )}
            {record.status === "APPROVED" &&
              permissions.includes("salary.pay") && (
                <button
                  className="button button-primary"
                  disabled={busy}
                  onClick={() =>
                    window.confirm("Mark this salary as paid?") &&
                    void onAction({ action: "PAY" })
                  }
                >
                  Mark paid
                </button>
              )}
            {record.status === "DRAFT" &&
              permissions.includes("salary.adjust") && (
                <form
                  className="advance-edit-form"
                  onSubmit={submitAdjustment}
                >
                  <label className="field">
                    <span>Adjustment</span>
                    <select
                      value={adjustmentKind}
                      onChange={(event) => setAdjustmentKind(event.target.value)}
                    >
                      <option value="OVERTIME">Overtime</option>
                      <option value="ALLOWANCE">Allowance</option>
                      <option value="DEDUCTION">Deduction</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Label</span>
                    <input
                      value={adjustmentLabel}
                      onChange={(event) => setAdjustmentLabel(event.target.value)}
                      minLength={2}
                      maxLength={100}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Amount (INR)</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={adjustmentAmount}
                      onChange={(event) => setAdjustmentAmount(event.target.value)}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Reason</span>
                    <input
                      value={adjustmentReason}
                      onChange={(event) => setAdjustmentReason(event.target.value)}
                      minLength={5}
                      maxLength={500}
                      required
                    />
                  </label>
                  <button className="button button-primary" disabled={busy}>
                    Apply adjustment
                  </button>
                </form>
              )}
            {record.status === "DRAFT" &&
              permissions.includes("salary.approve") && (
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() =>
                    void onAction({ action: "APPROVE" })
                  }
                >
                  Approve payroll
                </button>
              )}
            {record.status === "PAID" && !isMainAdmin && (
              <p className="sub-cell">
                Only MAIN_ADMIN can correct or reverse a paid payroll record.
              </p>
            )}
          </div>
        </section>
      </div>
    );
  }

  function SalaryGenerateModal({
    employee,
    month,
    canApprove,
    canDeductLoan,
    busy,
    onClose,
    onSubmit,
  }: {
    employee: PayrollEmployeeView;
    month: string;
    canApprove: boolean;
    canDeductLoan: boolean;
    busy: boolean;
    onClose: () => void;
    onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  }) {
    type Amounts = {
      grossEarnings: number;
      advances: number;
      esi: number;
      employeePf: number;
      employerPf: number;
      loanDeduction: number;
    };
    type Preview = {
      counts: AttendanceCounts;
      amounts: Amounts;
      outstandingLoanTotal: number;
      advances: Array<{
        _id: string;
        date: string;
        amount: number;
        reference: string;
      }>;
    };
    const [periodStart, setPeriodStart] = useState(
      employee.nextPeriodStart ?? `${month}-01`,
    );
    const [periodEnd, setPeriodEnd] = useState(
      employee.suggestedPeriodEnd ?? "",
    );
    const [preview, setPreview] = useState<Preview | null>(null);
    const [amounts, setAmounts] = useState<Amounts | null>(null);
    const [advanceIds, setAdvanceIds] = useState<string[]>([]);
    const [previewError, setPreviewError] = useState("");
    const [approveNow, setApproveNow] = useState(false);
    const loadingPreview =
      Boolean(periodStart && periodEnd) && !preview && !previewError;

    useEffect(() => {
      if (!periodStart || !periodEnd) {
        return;
      }
      let current = true;
      const params = new URLSearchParams({
        month,
        outletId: employee.outletId,
        employeeId: employee._id,
        periodStart,
        periodEnd,
      });
      void request<Preview>(`/api/payroll/preview?${params.toString()}`)
        .then((result) => {
          if (!current) return;
          setPreview(result);
          setAmounts(result.amounts);
          setAdvanceIds(result.advances.map((advance) => advance._id));
        })
        .catch((caught) => {
          if (!current) return;
          setPreviewError(
            caught instanceof Error ? caught.message : "Unable to prepare payroll preview.",
          );
        });
      return () => {
        current = false;
      };
    }, [employee._id, employee.outletId, month, periodEnd, periodStart]);

    const netPayable = amounts
      ? amounts.grossEarnings -
        amounts.advances -
        amounts.esi -
        amounts.employeePf -
        amounts.loanDeduction
      : 0;
    function submit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (!amounts || !periodEnd) return;
      void onSubmit({
        month,
        outletId: employee.outletId,
        employeeId: employee._id,
        periodStart,
        periodEnd,
        advanceIds,
        approve: approveNow,
        amounts,
      });
    }

    return (
      <div className="advance-modal-backdrop">
        <section
          className="advance-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="salary-generate-title"
        >
          <header className="advance-modal-heading">
            <div>
              <h2 id="salary-generate-title">Review payroll</h2>
              <p>
                {employee.fullName} · {employee.employeeCode} ·{" "}
                {employee.outletCode}
              </p>
            </div>
            <button
              type="button"
              className="button button-small"
              aria-label="Close payroll review"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </header>
          {loadingPreview ? (
            <Loading />
          ) : previewError ? (
            <div className="notice notice-error">{previewError}</div>
          ) : (
            <form className="advance-edit-form" onSubmit={submit}>
              <label className="field">
                <span>Period from</span>
                <input
                  type="date"
                  value={periodStart}
                  min={`${month}-01`}
                  max={`${month}-${String(getMonthDatesLocal(month)).padStart(2, "0")}`}
                  onChange={(event) => {
                    setPreview(null);
                    setAmounts(null);
                    setPreviewError("");
                    setPeriodStart(event.target.value);
                  }}
                  required
                />
              </label>
              <label className="field">
                <span>Period through</span>
                <input
                  type="date"
                  value={periodEnd}
                  min={periodStart}
                  max={employee.suggestedPeriodEnd ?? periodEnd}
                  onChange={(event) => {
                    setPreview(null);
                    setAmounts(null);
                    setPreviewError("");
                    setPeriodEnd(event.target.value);
                  }}
                  required
                />
              </label>
              {preview && (
                <>
                  <p className="sub-cell">
                    Attendance P / A / HD / WO: {preview.counts.P} /{" "}
                    {preview.counts.A} / {preview.counts.HD} /{" "}
                    {preview.counts.WO}. Monthly base salary:{" "}
                    {currency(employee.monthlyBaseSalary)}.
                  </p>
                  <AmountField
                    label="Gross earnings (INR)"
                    value={amounts?.grossEarnings ?? 0}
                    onChange={(value) =>
                      setAmounts((current) =>
                        current ? { ...current, grossEarnings: value } : current,
                      )
                    }
                  />
                  <AmountField
                    label="Approved advances (INR)"
                    value={amounts?.advances ?? 0}
                    disabled
                    onChange={() => {}}
                    help="Select which approved advances to deduct below."
                  />
                  {preview.advances.map((advance) => (
                    <label className="field" key={advance._id}>
                      <span>
                        <input
                          type="checkbox"
                          checked={advanceIds.includes(advance._id)}
                          onChange={(event) => {
                            const nextIds = event.target.checked
                              ? [...advanceIds, advance._id]
                              : advanceIds.filter((id) => id !== advance._id);
                            const nextTotal = preview.advances
                              .filter((item) => nextIds.includes(item._id))
                              .reduce((sum, item) => sum + item.amount, 0);
                            setAdvanceIds(nextIds);
                            setAmounts((current) =>
                              current
                                ? { ...current, advances: nextTotal }
                                : current,
                            );
                          }}
                        />{" "}
                        {formatDate(advance.date)} · {advance.reference || "Advance"} ·{" "}
                        {currency(advance.amount)}
                      </span>
                    </label>
                  ))}
                  <AmountField
                    label="Employee ESI (INR)"
                    value={amounts?.esi ?? 0}
                    onChange={(value) =>
                      setAmounts((current) =>
                        current ? { ...current, esi: value } : current,
                      )
                    }
                  />
                  <AmountField
                    label="Employee PF deduction (INR)"
                    value={amounts?.employeePf ?? 0}
                    onChange={(value) =>
                      setAmounts((current) =>
                        current ? { ...current, employeePf: value } : current,
                      )
                    }
                  />
                  <AmountField
                    label="Employer PF tracked (INR)"
                    value={amounts?.employerPf ?? 0}
                    onChange={(value) =>
                      setAmounts((current) =>
                        current ? { ...current, employerPf: value } : current,
                      )
                    }
                  />
                  <AmountField
                    label="Monthly loan deduction (INR)"
                    value={amounts?.loanDeduction ?? 0}
                    max={preview.outstandingLoanTotal}
                    disabled={!canDeductLoan || preview.outstandingLoanTotal <= 0}
                    readOnly
                    onChange={(value) =>
                      setAmounts((current) =>
                        current ? { ...current, loanDeduction: value } : current,
                      )
                    }
                    help={
                      canDeductLoan
                        ? `Configured monthly deduction: ${currency(preview.amounts.loanDeduction)} · Remaining balance: ${currency(preview.outstandingLoanTotal)}`
                        : "Only the main administrator can enter loan repayments."
                    }
                  />
                  <div className="salary-preview-net">
                    <span>Net payable</span>
                    <strong>{currency(netPayable)}</strong>
                  </div>
                  {canApprove && (
                    <label className="field">
                      <span>
                        <input
                          type="checkbox"
                          checked={approveNow}
                          onChange={(event) =>
                            setApproveNow(event.target.checked)
                          }
                        />{" "}
                        Generate and approve this payroll
                      </span>
                    </label>
                  )}
                  <button
                    className="button button-primary"
                    disabled={busy || loadingPreview || !amounts}
                  >
                    {approveNow ? "Generate & approve" : "Generate draft"}
                  </button>
                </>
              )}
            </form>
          )}
        </section>
      </div>
    );
  }

  function AmountField({
    label,
    value,
    onChange,
    max,
    disabled = false,
    help,
    readOnly = false,
  }: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    max?: number;
    disabled?: boolean;
    help?: string;
    readOnly?: boolean;
  }) {
    return (
      <label className="field">
        <span>{label}</span>
        <input
          type="number"
          min="0"
          max={max}
          step="0.01"
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          onChange={(event) => onChange(Number(event.target.value))}
          required
        />
        {help && <small>{help}</small>}
      </label>
    );
  }

  function getMonthDatesLocal(month: string) {
    const [year, monthNumber] = month.split("-").map(Number);
    return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  }

  function getAwayDateRange(
    period: string,
    customFrom: string,
    customTo: string,
    today: string,
  ) {
    if (period === "CUSTOM") return { from: customFrom, to: customTo };
    if (period === "ALL_TIME") return { from: "0001-01-01", to: today };
    const end = new Date(`${today}T00:00:00.000Z`);
    const start = new Date(end);
    if (period === "THIS_MONTH") start.setUTCDate(1);
    if (period === "LAST_WEEK") start.setUTCDate(start.getUTCDate() - 6);
    if (period === "LAST_MONTH") {
      start.setUTCDate(1);
      start.setUTCMonth(start.getUTCMonth() - 1);
      end.setUTCDate(0);
    }
    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    };
  }

  function DashboardAttendanceOverview({
    employees,
    date,
    filter,
    onFilterChange,
  }: {
    employees: NonNullable<WorkspaceData["attendanceEmployees"]>;
    date: string;
    filter: "ALL" | "P" | "A" | "HD" | "WO" | "UNMARKED";
    onFilterChange: (filter: "ALL" | "P" | "A" | "HD" | "WO" | "UNMARKED") => void;
  }) {
    const filteredEmployees = employees.filter((employee) => {
      if (filter === "ALL") return true;
      if (filter === "UNMARKED") return employee.status === null;
      return employee.status === filter;
    });

    return (
      <section className="panel dashboard-checkins-panel">
        <div className="panel-heading dashboard-checkins-heading">
          <div>
            <span className="dashboard-panel-kicker">TEAM ATTENDANCE</span>
            <h2>Attendance overview</h2>
            <p>
              {formatDate(date)} · {employees.length} team members in your
              accessible outlets
            </p>
          </div>
          <div
            className="dashboard-checkin-filters"
            role="group"
            aria-label="Filter attendance employees"
          >
            {([
              ["ALL", "All"],
              ["P", "Present"],
              ["A", "Absent"],
              ["HD", "Half day"],
              ["WO", "Week off"],
              ["UNMARKED", "Unmarked"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={filter === value ? "dashboard-filter-active" : ""}
                aria-pressed={filter === value}
                onClick={() => onFilterChange(value)}
              >
                {label}
              </button>
            ))}
            <span
              className="dashboard-late-unavailable"
              title="Check-in times are not stored in attendance records"
            >
              Late · not tracked
            </span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="dashboard-checkin-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>Check-in</th>
                <th>Hours</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map((employee) => (
                <tr key={employee.employeeId}>
                  <td>
                    <span className="dashboard-employee-cell">
                      <span className="dashboard-employee-avatar">
                        {employee.employeeName.slice(0, 1).toUpperCase()}
                      </span>
                      <span>
                        <strong>{employee.employeeName}</strong>
                        <small>
                          {employee.employeeCode} · {employee.outletCode || "Outlet"}
                        </small>
                      </span>
                    </span>
                  </td>
                  <td>{employee.designation || "—"}</td>
                  <td>
                    <span className="dashboard-untracked">
                      <Clock3 size={13} /> Not captured
                    </span>
                  </td>
                  <td>
                    <span className="dashboard-hours-placeholder">Not tracked</span>
                  </td>
                  <td>
                    <span
                      className={`badge ${employee.status ? `attendance-status-${employee.status.toLowerCase()}` : "badge-muted"}`}
                    >
                      {employee.status === "P"
                        ? "Present"
                        : employee.status === "A"
                          ? "Absent"
                          : employee.status === "HD"
                            ? "Half day"
                            : employee.status === "WO"
                              ? "Week off"
                              : "Unmarked"}
                    </span>
                    {employee.status && !employee.submitted && (
                      <small className="dashboard-draft-label">Draft</small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredEmployees.length === 0 && (
            <Empty>
              {employees.length
                ? "No team members match this status filter."
                : "No employee attendance is available for this date and outlet scope."}
            </Empty>
          )}
        </div>
      </section>
    );
  }

  function DashboardOutletOperations({
    date,
    outlets,
  }: {
    date: string;
    outlets: DashboardOutlet[];
  }) {
    return (
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Outlet operations</h2>
            <p>Attendance and submission progress for {date}</p>
          </div>
          <span className="live-tag">
            <i /> LIVE
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Outlet</th>
                <th>Active team</th>
                <th>Present</th>
                <th>Absent</th>
                <th>Half day</th>
                <th>Submission</th>
              </tr>
            </thead>
            <tbody>
              {outlets.map((outlet) => (
                <tr key={outlet.id}>
                  <td>
                    <strong>{outlet.code}</strong>
                    <span className="sub-cell">{outlet.name}</span>
                  </td>
                  <td>{outlet.employees}</td>
                  <td>{outlet.attendance?.P ?? 0}</td>
                  <td>{outlet.attendance?.A ?? 0}</td>
                  <td>{outlet.attendance?.HD ?? 0}</td>
                  <td>
                    <span
                      className={`badge ${outlet.submitted ? "badge-green" : "badge-red"}`}
                    >
                      {outlet.submitted ? "Submitted" : "Missing"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!outlets.length && (
            <Empty>No outlets are assigned to this account.</Empty>
          )}
        </div>
      </section>
    );
  }

  function DashboardAnalyticsSections({
    days,
    from,
    to,
    metrics,
    selectedOutlet,
    onSelectOutlet,
    canReadEmployees,
    canReadSalary,
  }: {
    days: NonNullable<WorkspaceData["attendanceTrend"]>;
    from: string;
    to: string;
    metrics?: WorkspaceData["metrics"];
    selectedOutlet: string;
    onSelectOutlet: (outletId: string) => void;
    canReadEmployees: boolean;
    canReadSalary: boolean;
  }) {
    const periodAttendance = days.reduce(
      (total, day) => ({
        P: total.P + day.attendance.P,
        A: total.A + day.attendance.A,
        HD: total.HD + day.attendance.HD,
        WO: total.WO + day.attendance.WO,
      }),
      { P: 0, A: 0, HD: 0, WO: 0 },
    );
    const outletTotals = new Map<
      string,
      { code: string; P: number; A: number; HD: number; WO: number }
    >();
    for (const day of days) {
      for (const outlet of day.outlets) {
        const total = outletTotals.get(outlet.id) ?? {
          code: outlet.code,
          P: 0,
          A: 0,
          HD: 0,
          WO: 0,
        };
        total.P += outlet.attendance.P;
        total.A += outlet.attendance.A;
        total.HD += outlet.attendance.HD;
        total.WO += outlet.attendance.WO;
        outletTotals.set(outlet.id, total);
      }
    }
    const outletPerformance = [...outletTotals.entries()]
      .map(([id, totals]) => {
        const marked = totals.P + totals.A + totals.HD;
        return {
          id,
          ...totals,
          rate: marked
            ? ((totals.P + totals.HD / 2) / marked) * 100
            : null,
        };
      })
      .sort((left, right) => (right.rate ?? -1) - (left.rate ?? -1));
    const lowestOutletWithData = [...outletPerformance]
      .filter((outlet) => outlet.rate !== null)
      .sort((left, right) => left.rate! - right.rate!)[0];
    const suggestions: Array<{
      title: string;
      detail: string;
      href: string;
      icon: "attendance" | "advance" | "payroll" | "outlet";
    }> = [];
    const missingOutlets = metrics?.missingSubmissions ?? 0;
    const unmarkedEmployees = metrics?.unmarkedAttendanceEmployees ?? 0;
    if (missingOutlets > 0)
      suggestions.push({
        title: `${missingOutlets} outlet${missingOutlets === 1 ? "" : "s"} missing attendance submission`,
        detail: `Review attendance for ${formatDate(to)}`,
        href: "/attendance",
        icon: "attendance",
      });
    if (unmarkedEmployees > 0)
      suggestions.push({
        title: `${unmarkedEmployees} team member${unmarkedEmployees === 1 ? "" : "s"} not marked`,
        detail: "Complete the attendance list for this date",
        href: "/attendance",
        icon: "attendance",
      });
    if ((metrics?.pendingAdvanceApprovals ?? 0) > 0)
      suggestions.push({
        title: `${metrics?.pendingAdvanceApprovals} advance request${metrics?.pendingAdvanceApprovals === 1 ? "" : "s"} awaiting review`,
        detail: "Review pending advance requests",
        href: "/advances",
        icon: "advance",
      });
    if ((metrics?.pendingPayroll ?? 0) > 0)
      suggestions.push({
        title: `${metrics?.pendingPayroll} payroll draft${metrics?.pendingPayroll === 1 ? "" : "s"} to review`,
        detail: "Open the selected month’s payroll records",
        href: "/salary",
        icon: "payroll",
      });
    if (lowestOutletWithData)
      suggestions.push({
        title: `${lowestOutletWithData.code} has the lowest recorded attendance rate`,
        detail: `${lowestOutletWithData.rate!.toFixed(1)}% · review the selected period`,
        href: "/attendance",
        icon: "outlet",
      });
    if (!suggestions.length) {
      const hasAttendance = days.some((day) =>
        Object.values(day.attendance).some((count) => count > 0),
      );
      suggestions.push({
        title: hasAttendance
          ? "No outstanding attendance actions found"
          : "No attendance has been recorded for this period",
        detail: hasAttendance
          ? "Attendance and outlet submissions are up to date"
          : `Review the attendance range ending ${formatDate(to)}`,
        href: "/attendance",
        icon: "attendance",
      });
    }

    return (
      <>
        <div className="dashboard-analytics-trend-row">
          <DashboardAttendanceTrend days={days} from={from} to={to} />
          <AttendanceStatusChart
            attendance={periodAttendance}
            subtitle={`${formatDate(from)} – ${formatDate(to)}`}
          />
        </div>
        <div className="dashboard-analytics-grid">
          <DashboardAttendanceHeatmap days={days} from={from} to={to} />
          <DashboardOutletRanking
            outlets={outletPerformance}
            selectedOutlet={selectedOutlet}
            onSelect={onSelectOutlet}
          />
          {canReadEmployees && (
            <DashboardTeamPerformanceLoader from={from} to={to} outletId={selectedOutlet} />
          )}
        </div>
        <div className="dashboard-payroll-suggestions-grid">
          {canReadSalary && (
            <DashboardPayrollBreakdown
              metrics={metrics}
              employeeCount={metrics?.activeEmployees ?? 0}
              from={from}
              to={to}
            />
          )}
          <DashboardSuggestions items={suggestions} />
        </div>
      </>
    );
  }

  function DashboardTeamPerformanceLoader({
    from,
    to,
    outletId,
  }: {
    from: string;
    to: string;
    outletId: string;
  }) {
    const report = useEmployeeAttendanceReport({
      enabled: true,
      from,
      to,
      outletId,
      employeeId: "",
    });
    if (report.error)
      return (
        <section className="panel dashboard-ranking-panel dashboard-team-panel">
          <div className="notice notice-error" role="alert">
            {report.error}
          </div>
        </section>
      );
    if (report.isFetching)
      return (
        <section className="panel dashboard-ranking-panel dashboard-team-panel">
          <div className="loading-state" role="status">Loading team performance</div>
        </section>
      );
    return <DashboardTeamPerformance rows={report.rows} from={from} to={to} />;
  }

  function WhoIsAwayPanel({
    employees,
    period,
    customFrom,
    customTo,
    canExport,
    exportBusy,
    onPeriodChange,
    onCustomFromChange,
    onCustomToChange,
    onExport,
  }: {
    employees: WhoIsAwayView[];
    period: string;
    customFrom: string;
    customTo: string;
    canExport: boolean;
    exportBusy: ExportFormat | null;
    onPeriodChange: (value: string) => void;
    onCustomFromChange: (value: string) => void;
    onCustomToChange: (value: string) => void;
    onExport: (format: ExportFormat) => void;
  }) {
    return (
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Who’s Away</h2>
            <p>Submitted attendance marked Absent or Half-day.</p>
          </div>
          <div className="toolbar">
            <label className="field">
            <span>Range</span>
              <select
                aria-label="Attendance date range"
                value={period}
                onChange={(event) => onPeriodChange(event.target.value)}
              >
                <option value="TODAY">Today</option>
                <option value="THIS_MONTH">This month</option>
                <option value="LAST_WEEK">Last 7 days</option>
                <option value="LAST_MONTH">Last month</option>
                <option value="ALL_TIME">All time</option>
                <option value="CUSTOM">Custom range</option>
              </select>
            </label>
            {period === "CUSTOM" && (
              <>
                <input
                  aria-label="Attendance start date"
                  type="date"
                  value={customFrom}
                  onChange={(event) => onCustomFromChange(event.target.value)}
                />
                <input
                  aria-label="Attendance end date"
                  type="date"
                  value={customTo}
                  onChange={(event) => onCustomToChange(event.target.value)}
                />
              </>
            )}
            {canExport &&
              (["xlsx", "csv"] as const).map((format) => (
                <button
                  key={format}
                  className="button button-secondary"
                  onClick={() => onExport(format)}
                  disabled={!employees.length || exportBusy !== null}
                  title={
                    format === "csv"
                      ? "CSV is plain tabular data; use Excel for formatting."
                      : "Download a formatted Excel workbook."
                  }
                >
                  {exportBusy === format ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : format === "xlsx" ? (
                    <FileSpreadsheet size={15} />
                  ) : (
                    <FileText size={15} />
                  )}
                  {format === "xlsx" ? "Excel" : "CSV"}
                </button>
              ))}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Outlet</th>
                <th>Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={`${employee.employeeId}-${employee.date}`}>
                  <td>
                    <strong>{employee.employeeName}</strong>
                    <span className="sub-cell">{employee.employeeCode}</span>
                  </td>
                  <td>{employee.outletCode}</td>
                  <td>{formatDate(employee.date)}</td>
                  <td>
                    <span
                      className={`badge ${employee.status === "A" ? "attendance-status-a" : "attendance-status-hd"}`}
                    >
                      {employee.status === "A" ? "Absent" : "Half-day"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!employees.length && (
            <Empty>No submitted absent or half-day records for this range.</Empty>
          )}
        </div>
      </section>
    );
  }

  function AttendanceStatusChart({
    attendance,
    subtitle = "Today’s marked staff by attendance status",
  }: {
    attendance: AttendanceCounts;
    subtitle?: string;
  }) {
    const data = [
      { name: "Present", value: attendance.P, color: "var(--status-present)", status: "p" },
      { name: "Absent", value: attendance.A, color: "var(--status-absent)", status: "a" },
      { name: "Half day", value: attendance.HD, color: "var(--status-half)", status: "hd" },
      { name: "Week off", value: attendance.WO, color: "var(--status-weekoff)", status: "wo" },
    ].filter((item) => item.value > 0);

    return (
      <section className="panel chart-panel">
        <div className="panel-heading">
          <div>
            <h2>Attendance Summary</h2>
            <p>{subtitle}</p>
          </div>
        </div>
        <div className="chart-area">
          {data.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="52%"
                  outerRadius="76%"
                  paddingAngle={3}
                >
                  {data.map((item) => (
                    <Cell
                      key={item.name}
                      className={`attendance-status-segment attendance-status-${item.status}`}
                      fill={item.color}
                    />
                  ))}
                </Pie>
                <Tooltip />
                <Legend
                  verticalAlign="bottom"
                  height={30}
                  wrapperStyle={{ fontSize: 10 }}
                  formatter={(value) => (
                    <span className="attendance-chart-legend-label">{value}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <Empty>No attendance has been marked for this date.</Empty>
          )}
        </div>
      </section>
    );
  }

  function DashboardAttendanceTrend({
    days,
    from,
    to,
  }: {
    days: NonNullable<WorkspaceData["attendanceTrend"]>;
    from: string;
    to: string;
  }) {
    const data = days.flatMap((day, index) => {
      const { P, A, HD } = day.attendance;
      const marked = P + A + HD;
      return marked
        ? [{ ...day, index, rate: ((P + HD / 2) / marked) * 100 }]
        : [];
    });
    const chartWidth = 600;
    const chartHeight = 190;
    const left = 42;
    const right = 12;
    const top = 14;
    const bottom = 25;
    const plotWidth = chartWidth - left - right;
    const plotHeight = chartHeight - top - bottom;
    const x = (index: number) =>
      left +
      (days.length > 1 ? (index / (days.length - 1)) * plotWidth : plotWidth / 2);
    const y = (rate: number) => top + ((100 - rate) / 100) * plotHeight;
    const line = data
      .map((point, index) => `${index ? "L" : "M"}${x(point.index)},${y(point.rate)}`)
      .join(" ");
    const area = data.length
      ? `${line} L${x(data[data.length - 1].index)},${top + plotHeight} L${x(data[0].index)},${top + plotHeight} Z`
      : "";
    const labelIndexes = new Set([
      0,
      Math.floor((days.length - 1) / 4),
      Math.floor((days.length - 1) / 2),
      Math.floor(((days.length - 1) * 3) / 4),
      days.length - 1,
    ]);

    return (
      <section className="panel dashboard-trend-panel">
        <div className="panel-heading">
          <div>
            <h2>Attendance trend</h2>
            <p>Daily attendance rate · {formatDate(from)} – {formatDate(to)}</p>
          </div>
          <span className="dashboard-live-label"><i /> LIVE DATA</span>
        </div>
        <div className="dashboard-trend-chart">
          {data.length ? (
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Daily attendance rate trend">
              <defs>
                <linearGradient id="dashboard-attendance-area" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#39a564" stopOpacity=".22" />
                  <stop offset="100%" stopColor="#39a564" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[100, 50, 0].map((rate) => (
                <g key={rate}>
                  <line x1={left} x2={chartWidth - right} y1={y(rate)} y2={y(rate)} className="dashboard-chart-gridline" />
                  <text x={left - 8} y={y(rate) + 3} textAnchor="end" className="dashboard-chart-axis-label">{rate}%</text>
                </g>
              ))}
              <path d={area} fill="url(#dashboard-attendance-area)" />
              <path d={line} className="dashboard-trend-line" />
              {data.map((point) => (
                <circle key={point.date} cx={x(point.index)} cy={y(point.rate)} r="3.1" className="dashboard-trend-point">
                  <title>{formatDate(point.date)} · {point.rate.toFixed(1)}% · {point.attendance.P} present, {point.attendance.A} absent, {point.attendance.HD} half-day</title>
                </circle>
              ))}
              {days.map((day, index) =>
                labelIndexes.has(index) ? (
                  <text key={day.date} x={x(index)} y={chartHeight - 5} textAnchor="middle" className="dashboard-chart-axis-label">
                    {new Date(`${day.date}T00:00:00Z`).getUTCDate()}
                  </text>
                ) : null,
              )}
            </svg>
          ) : (
            <Empty>No attendance records are available for this period.</Empty>
          )}
        </div>
      </section>
    );
  }

  function DashboardAttendanceHeatmap({
    days,
    from,
    to,
  }: {
    days: NonNullable<WorkspaceData["attendanceTrend"]>;
    from: string;
    to: string;
  }) {
    const firstDay = days[0]?.date;
    const mondayOffset = firstDay
      ? (new Date(`${firstDay}T00:00:00Z`).getUTCDay() + 6) % 7
      : 0;
    return (
      <section className="panel dashboard-heatmap-panel">
        <div className="panel-heading">
          <div>
            <h2>Attendance heatmap</h2>
            <p>{formatDate(from)} – {formatDate(to)} · <span className="heatmap-legend-high">●</span> high <span className="heatmap-legend-mid">●</span> mid <span className="heatmap-legend-low">●</span> low</p>
          </div>
        </div>
        <div className="dashboard-heatmap">
          {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
            <span className="dashboard-heatmap-weekday" key={`${day}-${index}`}>{day}</span>
          ))}
          {Array.from({ length: mondayOffset }, (_, index) => (
            <span className="dashboard-heatmap-empty" key={`offset-${index}`} />
          ))}
          {days.map((day) => {
            const { P, A, HD, WO } = day.attendance;
            const marked = P + A + HD;
            const rate = marked ? ((P + HD / 2) / marked) * 100 : null;
            const tone =
              rate === null
                ? marked + WO > 0
                  ? "weekoff"
                  : "no-data"
                : rate >= 90
                  ? "high"
                  : rate >= 75
                    ? "mid"
                    : "low";
            return (
              <span
                key={day.date}
                className={`dashboard-heatmap-day heatmap-${tone}`}
                title={`${formatDate(day.date)} · ${rate === null ? (WO ? "Week off / no attendance marks" : "No attendance data") : `${rate.toFixed(1)}% attendance · P ${P}, A ${A}, HD ${HD}, WO ${WO}`}`}
              >
                {new Date(`${day.date}T00:00:00Z`).getUTCDate()}
              </span>
            );
          })}
        </div>
      </section>
    );
  }

  function DashboardOutletRanking({
    outlets,
    selectedOutlet,
    onSelect,
  }: {
    outlets: Array<{
      id: string;
      code: string;
      rate: number | null;
      P: number;
      A: number;
      HD: number;
      WO: number;
    }>;
    selectedOutlet: string;
    onSelect: (outletId: string) => void;
  }) {
    return (
      <section className="panel dashboard-ranking-panel">
        <div className="panel-heading">
          <div>
            <h2>Outlet ranking</h2>
            <p>Attendance rate · selected period</p>
          </div>
        </div>
        <div className="dashboard-ranking-list">
          {outlets.map((outlet) => (
            <button
              type="button"
              key={outlet.id}
              className={`dashboard-ranking-row ${selectedOutlet === outlet.id ? "dashboard-ranking-selected" : ""}`}
              onClick={() => onSelect(selectedOutlet === outlet.id ? "" : outlet.id)}
              title={`${outlet.code} · ${outlet.rate === null ? "No attendance data" : `${outlet.rate.toFixed(1)}% attendance`}`}
            >
              <span>{outlet.code}</span>
              <span className="dashboard-ranking-bar"><i className={dashboardPercentClass(outlet.rate ?? 0, "dashboard-width")} /></span>
              <strong>{outlet.rate === null ? "No data" : `${outlet.rate.toFixed(1)}%`}</strong>
            </button>
          ))}
          {!outlets.length && <Empty>No accessible outlets.</Empty>}
        </div>
      </section>
    );
  }

  function DashboardTeamPerformance({
    rows,
    from,
    to,
  }: {
    rows: EmployeeAttendanceReportRow[];
    from: string;
    to: string;
  }) {
    const team = rows
      .map((row) => {
        const marked = row.presentDays + row.absentDays + row.halfDays;
        return {
          ...row,
          rate: marked
            ? ((row.presentDays + row.halfDays / 2) / marked) * 100
            : null,
        };
      })
      .filter((row) => row.rate !== null)
      .sort((left, right) => (right.rate ?? 0) - (left.rate ?? 0))
      .slice(0, 5);
    return (
      <section className="panel dashboard-ranking-panel dashboard-team-panel">
        <div className="panel-heading">
          <div>
            <h2>Team performance</h2>
            <p>Attendance rate · {formatDate(from)} – {formatDate(to)}</p>
          </div>
        </div>
        <div className="dashboard-team-list">
          {team.map((employee) => (
            <Link
              href={`/employees/${employee.employeeId}`}
              key={employee.employeeId}
              className="dashboard-team-row"
            >
              <span className="dashboard-team-avatar">{employee.employeeName.slice(0, 1).toUpperCase()}</span>
              <span className="dashboard-team-detail">
                <span><strong>{employee.employeeName}</strong><small>{employee.outletCode}</small></span>
                <span className="dashboard-ranking-bar"><i className={dashboardPercentClass(employee.rate ?? 0, "dashboard-width")} /></span>
              </span>
              <strong className="dashboard-team-rate">{employee.rate?.toFixed(1)}%<small>A {employee.absentDays} · HD {employee.halfDays}</small></strong>
            </Link>
          ))}
          {!team.length && <Empty>No employee attendance data is available for this period.</Empty>}
        </div>
      </section>
    );
  }

  function DashboardPayrollBreakdown({
    metrics,
    employeeCount,
    from,
    to,
  }: {
    metrics?: WorkspaceData["metrics"];
    employeeCount: number;
    from: string;
    to: string;
  }) {
    const gross = metrics?.grossSalary ?? 0;
    const net = metrics?.netPayable ?? 0;
    const progress = gross > 0 ? Math.max(0, Math.min(100, (net / gross) * 100)) : 0;
    return (
      <section className="panel dashboard-payroll-panel">
        <div className="panel-heading">
          <div>
            <h2>Payroll breakdown</h2>
            <p>Live accrual · {formatDate(from)} – {formatDate(to)}</p>
          </div>
          <Link className="dashboard-panel-link" href="/salary">Review payroll <ArrowUpRight size={14} /></Link>
        </div>
        <div className="dashboard-payroll-content">
          {metrics?.grossSalary == null ? (
            <Empty>Salary permission is required to view payroll totals.</Empty>
          ) : (
            <>
              <div className="dashboard-payroll-progress" aria-label={`${progress.toFixed(0)} percent of gross earnings remains net payable`}>
                <i className={dashboardPercentClass(progress, "dashboard-width")} />
              </div>
              <div className="dashboard-payroll-values">
                <div><span>Gross accrued</span><strong>{currency(gross)}</strong></div>
                <div><span>Advances awaiting payroll</span><strong>{metrics.approvedAdvancesPendingPayroll == null ? "—" : currency(metrics.approvedAdvancesPendingPayroll)}</strong></div>
                <div><span>Loan deductions in generated payroll</span><strong>{metrics.payrollCount ? currency(metrics.recordedLoanDeductions ?? 0) : "No payroll records"}</strong></div>
                <div><span>Net accrued</span><strong className="payroll-value-net">{currency(net)}</strong></div>
                <div><span>Projected month-end base</span><strong>{metrics.projectedMonthEndBase == null ? "—" : currency(metrics.projectedMonthEndBase)}</strong><small>Before attendance and deductions</small></div>
                <div><span>Average net / active employee</span><strong>{employeeCount ? currency(net / employeeCount) : currency(0)}</strong><small>Current accrued amount</small></div>
              </div>
              <p className="dashboard-payroll-note">
                Accrual uses submitted attendance and current payroll rules. Live accrual does not include loan deductions; those are shown from generated payroll records.
              </p>
            </>
          )}
        </div>
      </section>
    );
  }

  function DashboardSuggestions({
    items,
  }: {
    items: Array<{
      title: string;
      detail: string;
      href: string;
      icon: "attendance" | "advance" | "payroll" | "outlet";
    }>;
  }) {
    const Icon = {
      attendance: CalendarDays,
      advance: HandCoins,
      payroll: Banknote,
      outlet: Building2,
    };
    return (
      <section className="panel dashboard-suggestions-panel" id="dashboard-suggestions">
        <div className="panel-heading">
          <div>
            <h2>Smart suggestions</h2>
            <p>Operational prompts based on your records</p>
          </div>
        </div>
        <div className="dashboard-suggestions-list">
          {items.slice(0, 5).map((item) => {
            const SuggestionIcon = Icon[item.icon];
            return (
              <Link className="dashboard-suggestion" href={item.href} key={item.title}>
                <span><SuggestionIcon size={15} /></span>
                <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                <ArrowUpRight size={13} />
              </Link>
            );
          })}
        </div>
      </section>
    );
  }

  function AttendanceTrendChart({
    rows,
    from,
    to,
  }: {
    rows: EmployeeAttendanceReportRow[];
    from: string;
    to: string;
  }) {
    const groupByMonth =
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000 >
      62;
    const periods = new Map<
      string,
      { period: string; present: number; absent: number; halfDay: number; weekOff: number }
    >();
    for (const row of rows) {
      for (const [status, dates] of Object.entries(row.statusDates) as [
        AttendanceStatus,
        string[],
      ][]) {
        for (const date of dates) {
          const period = groupByMonth ? date.slice(0, 7) : date;
          const counts = periods.get(period) ?? {
            period,
            present: 0,
            absent: 0,
            halfDay: 0,
            weekOff: 0,
          };
          if (status === "P") counts.present += 1;
          if (status === "A") counts.absent += 1;
          if (status === "HD") counts.halfDay += 1;
          if (status === "WO") counts.weekOff += 1;
          periods.set(period, counts);
        }
      }
    }
    const data = [...periods.values()].sort((left, right) =>
      left.period.localeCompare(right.period),
    );

    return (
      <section className="panel chart-panel report-attendance-chart">
        <div className="panel-heading">
          <div>
            <h2>Attendance trend</h2>
            <p>
              {groupByMonth
                ? "Monthly marked attendance"
                : "Daily marked attendance"}{" "}
              · {formatDate(from)} to {formatDate(to)}
            </p>
          </div>
        </div>
        <div className="chart-area">
          {data.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                margin={{ top: 8, right: 16, left: -18, bottom: 0 }}
              >
                <CartesianGrid stroke="#eceee9" vertical={false} />
                <XAxis
                  dataKey="period"
                  tickFormatter={(period: string) =>
                    groupByMonth
                      ? new Intl.DateTimeFormat("en-GB", {
                          month: "short",
                          year: "numeric",
                          timeZone: "UTC",
                        }).format(new Date(`${period}-01T00:00:00Z`))
                      : formatDate(period)
                  }
                  tick={{ fill: "#777b74", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={14}
                />
                <Tooltip
                  labelFormatter={(period) =>
                    groupByMonth
                      ? `Month ${new Intl.DateTimeFormat("en-GB", {
                          month: "long",
                          year: "numeric",
                          timeZone: "UTC",
                        }).format(new Date(`${period}-01T00:00:00Z`))}`
                      : `Date ${formatDate(String(period))}`
                  }
                />
                <Legend
                  wrapperStyle={{ fontSize: 10 }}
                  formatter={(value) => (
                    <span className="attendance-chart-legend-label">{value}</span>
                  )}
                />
                <Bar className="attendance-chart-present" dataKey="present" name="Present" stackId="attendance" fill="var(--status-present)" />
                <Bar className="attendance-chart-absent" dataKey="absent" name="Absent" stackId="attendance" fill="var(--status-absent)" />
                <Bar className="attendance-chart-half" dataKey="halfDay" name="Half day" stackId="attendance" fill="var(--status-half)" />
                <Bar className="attendance-chart-weekoff" dataKey="weekOff" name="Week off" stackId="attendance" fill="var(--status-weekoff)" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty>No attendance data is available for this date range.</Empty>
          )}
        </div>
      </section>
    );
  }

  function DataTable({
    className,
    headers,
    rows,
    empty,
    page = 1,
    pageSize = 25,
    total,
    onPageChange,
  }: {
    className?: string;
    headers: string[];
    rows: React.ReactNode[][];
    empty: string;
    page?: number;
    pageSize?: number;
    total?: number;
    onPageChange?: (page: number) => void;
  }) {
    const pageCount =
      total === undefined ? 1 : Math.max(1, Math.ceil(total / pageSize));
    return (
      <section className={`panel ${className ?? ""}`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <Empty>{empty}</Empty>}
        </div>
        <div className="panel-footer">
          <span>
            {total ?? rows.length} records · page {page} of {pageCount}
          </span>
          <div className="pagination">
            <button
              className="icon-button"
              aria-label="Previous page"
              title="Previous page"
              disabled={!onPageChange || page <= 1}
              onClick={() => onPageChange?.(page - 1)}
            >
              <ChevronLeft size={17} />
            </button>
            <span>{page}</span>
            <button
              className="icon-button"
              aria-label="Next page"
              title="Next page"
              disabled={!onPageChange || page >= pageCount}
              onClick={() => onPageChange?.(page + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </section>
    );
  }

  function Field({
    id,
    label,
    name,
    type = "text",
    required,
    min,
    max,
    step,
    defaultValue,
    infoText,
    disabled,
  }: {
    id?: string;
    label: string;
    name: string;
    type?: string;
    required?: boolean;
    min?: string;
    max?: string;
    step?: string;
    defaultValue?: string;
    infoText?: string;
    disabled?: boolean;
  }) {
    return (
      <div className="field">
        <div className="field-label-row">
          <label htmlFor={id ?? `field-${name}`}>{label}</label>
          {infoText && <InfoTip text={infoText} />}
        </div>
        <input
          id={id ?? `field-${name}`}
          name={name}
          type={type}
          required={required}
          min={min}
          max={max}
          step={step}
          defaultValue={defaultValue}
          disabled={disabled}
        />
      </div>
    );
  }

  function InfoTip({ text }: { text: string }) {
    const [open, setOpen] = useState(false);
    const [hovered, setHovered] = useState(false);
    const visible = open || hovered;
    return (
      <span
        className={`field-info${open ? " field-info-open" : ""}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <button
          type="button"
          className="field-info-button"
          aria-label="More information"
          aria-expanded={open}
          title={text}
          onClick={() => setOpen((current) => !current)}
        >
          <Info size={14} />
        </button>
        <span
          className="field-info-tooltip"
          role="tooltip"
          hidden={!visible}
        >
          {text}
        </span>
      </span>
    );
  }

  function Empty({ children }: { children: React.ReactNode }) {
    return (
      <div className="empty-state">
        <span className="empty-mark">
          <SlidersHorizontal size={20} />
        </span>
        <strong>{children}</strong>
      </div>
    );
  }

  function currency(value: number | undefined) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(Number(value) || 0);
  }

  function LoanActionDialog({
    loan,
    action,
    payrollMonth,
    busy,
    onClose,
    onSubmit,
  }: {
    loan: LoanView;
    action: LoanActionName;
    payrollMonth: string;
    busy: boolean;
    onClose: () => void;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  }) {
    const [closureType, setClosureType] = useState(
      loan.outstandingAmount > 0 ? "EXTERNAL_SETTLEMENT" : "OTHER",
    );
    const title: Record<LoanActionName, string> = {
      SKIP: "Skip this month's installment",
      PAUSE: "Pause loan",
      RESUME: "Resume loan",
      CLOSE: "Mark loan as completed",
      ADJUST: "Adjust loan balance",
      REVERSE: "Reverse posted installment",
    };
    return (
      <div className="advance-modal-backdrop">
        <section
          className="advance-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="loan-action-title"
        >
          <header className="advance-modal-heading">
            <div>
              <h2 id="loan-action-title">{title[action]}</h2>
              <p>
                {loan.employeeName} · {loan.employeeCode} · {loan.outletCode}
              </p>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Close loan action"
              disabled={busy}
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </header>
          <form className="advance-edit-form" onSubmit={onSubmit}>
            <p className="sub-cell">
              Original amount: {currency(loan.totalAmount)} · Repaid:{" "}
              {currency(loan.repaidAmount ?? 0)} · Remaining balance:{" "}
              {currency(loan.outstandingAmount)}
            </p>
            {action === "SKIP" && (
              <p className="sub-cell">
                Payroll month: {payrollMonth} · Scheduled deduction:{" "}
                {currency(calculateLoanInstallment([loan], payrollMonth))}. The
                balance will not change and no arrears will be carried forward.
              </p>
            )}
            {action === "REVERSE" && (
              <p className="sub-cell">
                Payroll month: {payrollMonth} · Posted deduction:{" "}
                {currency(loan.currentActualDeduction ?? 0)}. This restores the
                loan balance and updates payroll.
              </p>
            )}
            {(action === "PAUSE" || action === "RESUME") && (
              <p className="sub-cell">
                Missed installments are not carried forward.{" "}
                {action === "RESUME" &&
                  "Deductions resume from the effective payroll month."}
              </p>
            )}
            {action === "CLOSE" && (
              <>
                <label className="field">
                  <span>Closure type</span>
                  <select
                    name="closureType"
                    value={closureType}
                    onChange={(event) => setClosureType(event.target.value)}
                  >
                    <option value="EXTERNAL_SETTLEMENT">
                      Fully or partially settled outside payroll
                    </option>
                    <option value="WRITE_OFF">Waived / written off</option>
                    <option value="OTHER">Other approved closure</option>
                  </select>
                </label>
                {loan.outstandingAmount > 0 &&
                  closureType === "EXTERNAL_SETTLEMENT" && (
                    <label className="field">
                      <span>Settlement amount (INR)</span>
                      <input
                        name="amount"
                        type="number"
                        min="0.01"
                        max={loan.outstandingAmount}
                        step="0.01"
                        defaultValue={loan.outstandingAmount}
                        required
                      />
                      <small>
                        A partial settlement reduces the balance and leaves the
                        loan ongoing.
                      </small>
                    </label>
                  )}
                <label className="field">
                  <span>Settlement / closure date</span>
                  <input
                    name="transactionDate"
                    type="date"
                    defaultValue={getIndiaDate()}
                    required
                  />
                </label>
              </>
            )}
            {action === "ADJUST" && (
              <>
                <label className="field">
                  <span>Balance change</span>
                  <select name="direction" defaultValue="REDUCE">
                    <option value="REDUCE">Reduce balance</option>
                    <option value="INCREASE">
                      Increase (additional disbursement)
                    </option>
                  </select>
                </label>
                <label className="field">
                  <span>Adjustment amount (INR)</span>
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    max="10000000"
                    step="0.01"
                    required
                  />
                </label>
                <label className="field">
                  <span>Adjustment date</span>
                  <input
                    name="transactionDate"
                    type="date"
                    defaultValue={getIndiaDate()}
                    required
                  />
                </label>
              </>
            )}
            {action === "REVERSE" && (
              <label className="field">
                <span>Reversal date</span>
                <input
                  name="transactionDate"
                  type="date"
                  defaultValue={getIndiaDate()}
                  required
                />
              </label>
            )}
            {action === "RESUME" && (
              <label className="field">
                <span>Effective payroll month</span>
                <input
                  name="effectiveMonth"
                  type="month"
                  defaultValue={payrollMonth}
                  min={payrollMonth}
                  required
                />
              </label>
            )}
            <label className="field">
              <span>Reason (required)</span>
              <textarea
                name="reason"
                minLength={5}
                maxLength={500}
                rows={3}
                required
              />
            </label>
            {(action === "ADJUST" || action === "CLOSE") && (
              <label className="field">
                <span>Reference or notes (optional)</span>
                <input name="reference" maxLength={200} />
              </label>
            )}
            <div className="toolbar">
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button button-primary"
                disabled={busy}
              >
                {busy ? "Saving…" : "Confirm action"}
              </button>
            </div>
          </form>
        </section>
      </div>
    );
  }

  function normalizeForm(values: Record<string, FormDataEntryValue>) {
    const body: Record<string, unknown> = { ...values };
    for (const key of [
      "monthlyBaseSalary",
      "employeePfPercent",
      "employerPfPercent",
      "esiPercent",
      "amount",
      "totalAmount",
      "outstandingAmount",
      "monthlyDeductionAmount",
      "installmentCount",
      "outletNumber",
    ]) {
      if (key in body) body[key] = Number(body[key]);
    }
    for (const key of ["pfEnabled", "esiEnabled", "active"]) {
      if (key in body) body[key] = body[key] === "true";
    }
    for (const key of ["outletIds", "permissions"]) {
      if (typeof body[key] === "string")
        body[key] = String(body[key])
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
    }
    return body;
  }

  function nextAvailableOutletNumber(outlets: Outlet[]) {
    const usedNumbers = new Set(
      outlets
        .map((outlet) => /^OUT(\d{2})$/.exec(outlet.code)?.[1])
        .filter((value): value is string => value !== undefined)
        .map(Number),
    );
    return Array.from({ length: 99 }, (_, index) => index + 1).find(
      (number) => !usedNumbers.has(number),
    ) ?? 1;
  }

  function OutletCard({
    outlet,
    onSave,
    disabled,
  }: {
    outlet: Outlet;
    onSave: (fields: Partial<Outlet>) => void;
    disabled: boolean;
  }) {
    const [name, setName] = useState(outlet.name ?? outlet.code);
    const [active, setActive] = useState(outlet.active ?? false);
    const [address, setAddress] = useState(outlet.address ?? "");
    const [city, setCity] = useState(outlet.city ?? "");
    const [managerName, setManagerName] = useState(outlet.managerName ?? "");
    const [contactPhone, setContactPhone] = useState(outlet.contactPhone ?? "");
    const changed =
      name !== outlet.name ||
      active !== outlet.active ||
      address !== (outlet.address ?? "") ||
      city !== (outlet.city ?? "") ||
      managerName !== (outlet.managerName ?? "") ||
      contactPhone !== (outlet.contactPhone ?? "");
    return (
      <article className="outlet-card">
        <div className="outlet-card-head">
          <span className="outlet-code">{outlet.code}</span>
          <span className={`badge ${active ? "badge-green" : "badge-muted"}`}>
            {active ? "Active" : "Inactive"}
          </span>
        </div>
        <label className="field">
          <span>Outlet name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={disabled}
          />
        </label>
        <label className="field">
          <span>Address</span>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            disabled={disabled}
          />
        </label>
        <label className="field">
          <span>City</span>
          <input
            value={city}
            onChange={(event) => setCity(event.target.value)}
            disabled={disabled}
          />
        </label>
        <label className="field">
          <span>Manager</span>
          <input
            value={managerName}
            onChange={(event) => setManagerName(event.target.value)}
            disabled={disabled}
          />
        </label>
        <label className="field">
          <span>Contact phone</span>
          <input
            value={contactPhone}
            onChange={(event) => setContactPhone(event.target.value)}
            disabled={disabled}
          />
        </label>
        {!!outlet.assignedUsers?.length && (
          <div className="assigned-users">
            <span>Assigned users</span>
            {outlet.assignedUsers.map((user) => (
              <small key={user.email}>
                {user.name} · {user.role.replaceAll("_", " ")}
              </small>
            ))}
          </div>
        )}
        <label className="toggle-row">
          <span>Available for operations</span>
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
            disabled={disabled}
          />
        </label>
        <button
          className="button button-secondary button-full"
          disabled={disabled || !changed}
          onClick={() => {
            if (
              outlet.active &&
              !active &&
              !window.confirm(
                `Deactivate ${outlet.code}? Historical records remain accessible.`,
              )
            )
              return;
            onSave({ name, active, address, city, managerName, contactPhone });
          }}
        >
          <Check size={15} /> Save outlet
        </button>
      </article>
    );
  }

  function DesignationManager({
    designations,
    onChanged,
  }: {
    designations: DesignationView[];
    onChanged: () => Promise<void>;
  }) {
    const [editingId, setEditingId] = useState("");
    const [isOpen, setIsOpen] = useState(false);
    const selected = designations.find((item) => item._id === editingId);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [permissions, setPermissions] = useState<Permission[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    function beginEdit(id: string) {
      const designation = designations.find((item) => item._id === id);
      setIsOpen(true);
      setEditingId(id);
      setName(designation?.name ?? "");
      setDescription(designation?.description ?? "");
      setPermissions(designation?.permissions ?? []);
      setError("");
    }

    function closeEditor() {
      setIsOpen(false);
      setEditingId("");
      setName("");
      setDescription("");
      setPermissions([]);
      setError("");
    }

    async function save(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      setBusy(true);
      setError("");
      try {
        const body = { name, description, permissions };
        await request(
          "/api/designations",
          {
            method: editingId ? "PUT" : "POST",
            body: JSON.stringify(editingId ? { id: editingId, ...body } : body),
          },
        );
        await onChanged();
        closeEditor();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to save the designation.",
        );
      } finally {
        setBusy(false);
      }
    }

    async function remove() {
      if (!editingId || selected?.assignedCount) return;
      if (!window.confirm(`Delete the ${selected?.name} designation?`)) return;
      setBusy(true);
      setError("");
      try {
        await request(`/api/designations/${editingId}`, { method: "DELETE" });
        await onChanged();
        closeEditor();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to delete the designation.",
        );
      } finally {
        setBusy(false);
      }
    }

    return (
      <section className="panel designation-panel">
        <div className="panel-heading">
          <div>
            <h2>Designations</h2>
            <p>
              Save a permission profile once and assign it to staff across outlets.
              Updating a profile updates every account using it.
            </p>
          </div>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => beginEdit("")}
          >
            <Plus size={15} /> New designation
          </button>
        </div>
        {!!designations.length && (
          <div className="designation-picker">
            <label className="field">
              <span>Edit a designation</span>
              <select
                value={editingId}
                onChange={(event) => beginEdit(event.target.value)}
                aria-label="Choose a designation to edit"
              >
                <option value="">Choose a designation to edit…</option>
                {designations.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.name} · {item.assignedCount ?? 0} assigned account(s)
                  </option>
                ))}
              </select>
            </label>
            <small>
              Select a designation to edit its permissions or remove it.
              Changes apply to every assigned account.
            </small>
          </div>
        )}
        {isOpen && <ModalPortal><div className="access-modal-backdrop">
          <section
            className="access-modal designation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="designation-modal-title"
          >
            <div className="access-modal-heading">
              <div>
                <h2 id="designation-modal-title">
                  {editingId ? "Edit designation" : "New designation"}
                </h2>
                <p>Set page access and save this reusable permission profile.</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close designation editor"
                disabled={busy}
                onClick={closeEditor}
              >
                <X size={18} />
              </button>
            </div>
            <Notice error={error} success="" />
            <form className="designation-form" onSubmit={save}>
          <div className="form-grid">
            <label className="field">
              <span>Designation name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Outlet Manager"
                minLength={2}
                maxLength={80}
                required
              />
            </label>
            <label className="field">
              <span>Description</span>
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What this role can do"
                maxLength={240}
              />
            </label>
          </div>
          <div className="designation-permissions">
            <div className="designation-permissions-heading">
              <strong>App page and action permissions</strong>
              <span>
                {permissions.length} selected · applies to assigned users
              </span>
            </div>
            {designationPermissionGroups.map((group) => (
              <fieldset key={group.title}>
                <legend>{group.title}</legend>
                <div className="permission-toggle-grid">
                  {group.permissions.map((permission) => (
                    <label key={permission.value}>
                      <input
                        type="checkbox"
                        checked={permissions.includes(permission.value)}
                        onChange={(event) =>
                          setPermissions((current) =>
                            event.target.checked
                              ? [...current, permission.value]
                              : current.filter(
                                  (value) => value !== permission.value,
                                ),
                          )
                        }
                      />
                      <span>{permission.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <fieldset className="admin-only-permissions">
              <legend>Admin-only pages</legend>
              {adminOnlyPages.map((page) => (
                <div key={page.permission}>
                  <span>{page.title}</span>
                  <small>MAIN_ADMIN only</small>
                </div>
              ))}
            </fieldset>
          </div>
          <div className="form-actions">
            <button className="button button-primary" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
              {editingId ? "Save designation" : "Create designation"}
            </button>
            {editingId && (
              <button
                className="button button-secondary"
                type="button"
                disabled={busy || (selected?.assignedCount ?? 0) > 0}
                title={
                  (selected?.assignedCount ?? 0) > 0
                    ? "Reassign users before deleting this designation."
                    : undefined
                }
                onClick={remove}
              >
                Delete
              </button>
            )}
          </div>
            </form>
          </section>
        </div></ModalPortal>}
      </section>
    );
  }

  function UserAccessControl({
    item,
    outlets,
    designations,
    onSave,
  }: {
    item: UserView;
    outlets: Outlet[];
    designations: DesignationView[];
    onSave: (input: Record<string, unknown>) => Promise<boolean>;
  }) {
    const [role, setRole] = useState(item.role as UserRole);
    const [isOpen, setIsOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [outletIds, setOutletIds] = useState<string[]>(
      (item.outletIds ?? []).map(String),
    );
    const [permissions, setPermissions] = useState<string[]>(
      item.designationId || item.permissionsCustomized
        ? item.permissions ?? []
        : item.role === "OUTLET_USER"
            ? legacyOutletDefaultPermissions
            : item.permissions ?? [],
    );
    const [designationId, setDesignationId] = useState(item.designationId ?? "");
    const [active, setActive] = useState(Boolean(item.active));
    const selectedRoleValue = designationId
      ? `designation:${designationId}`
      : role === "MAIN_ADMIN"
        ? role
        : "";

    function openEditor() {
      setRole(item.role);
      setOutletIds((item.outletIds ?? []).map(String));
      setPermissions(
        item.designationId || item.permissionsCustomized
          ? item.permissions ?? []
          : item.role === "OUTLET_USER"
            ? legacyOutletDefaultPermissions
            : item.permissions ?? [],
      );
      setDesignationId(item.designationId ?? "");
      setActive(Boolean(item.active));
      setIsOpen(true);
    }

    return (
      <div className="access-edit">
        <button
          className="button button-secondary access-manage-button"
          type="button"
          onClick={openEditor}
        >
          Manage
        </button>
        {isOpen && (
        <ModalPortal><div className="access-modal-backdrop">
          <section
            className="access-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`access-modal-title-${item._id}`}
          >
            <div className="access-modal-heading">
              <div>
                <h2 id={`access-modal-title-${item._id}`}>Manage access</h2>
                <p>{item.name} · {item.email}</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close access editor"
                onClick={() => setIsOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="access-edit-body">
          <label className="field">
            <span>Role</span>
            <select
              value={selectedRoleValue}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (nextValue.startsWith("designation:")) {
                  const nextDesignationId = nextValue.slice("designation:".length);
                  setDesignationId(nextDesignationId);
                  const selected = designations.find(
                    (designation) => designation._id === nextDesignationId,
                  );
                  if (selected) setPermissions([...selected.permissions]);
                  if (role === "MAIN_ADMIN") setRole("OUTLET_USER");
                  return;
                }
                const nextRole = nextValue as UserRole;
                setRole(nextRole);
                setDesignationId("");
                if (nextRole === "OUTLET_USER")
                  setOutletIds((current) => current.slice(0, 1));
              }}
            >
              {selectedRoleValue === "" && (
                <option value="" disabled>
                  Select Main Admin or a designation
                </option>
              )}
              <option value="MAIN_ADMIN">Main Admin</option>
              {designations.map((designation) => (
                <option
                  key={designation._id}
                  value={`designation:${designation._id}`}
                >
                  Designation · {designation.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Assigned outlets</span>
            <select
              multiple={role !== "OUTLET_USER"}
              size={role === "OUTLET_USER" ? 1 : 3}
              value={role === "OUTLET_USER" ? outletIds[0] ?? "" : outletIds}
              onChange={(event) =>
                setOutletIds(
                  role === "OUTLET_USER"
                    ? [event.target.value].filter(Boolean)
                    : Array.from(
                        event.target.selectedOptions,
                        (option) => option.value,
                      ),
                )
              }
            >
              {outlets
                .filter((outlet) => role !== "OUTLET_USER" || outlet.active)
                .map((outlet) => (
                <option key={outlet._id} value={outlet._id}>
                  {outlet.code} · {outlet.name}
                </option>
                ))}
            </select>
          </label>
          {designationId && (
            <small>
              {designations.find((designation) => designation._id === designationId)?.name}
              {" "}permissions sync automatically when the designation is edited.
            </small>
          )}
          {!designationId && role !== "MAIN_ADMIN" && (
            <div className="user-permission-groups">
              {designationPermissionGroups.map((group) => (
                <fieldset key={group.title}>
                  <legend>{group.title}</legend>
                  {group.permissions.map((permission) => (
                    <label key={permission.value}>
                      <input
                        type="checkbox"
                        checked={permissions.includes(permission.value)}
                        onChange={(event) =>
                          setPermissions((current) =>
                            event.target.checked
                              ? [...current, permission.value]
                              : current.filter(
                                  (value) => value !== permission.value,
                                ),
                          )
                        }
                      />
                      {permission.label}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          )}
          <label className="toggle-row">
            <span>Account active</span>
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
          </label>
          <button
            className="button button-primary button-full"
            type="button"
            disabled={isSaving}
            onClick={async () => {
              if (
                !window.confirm(
                  `Confirm this access change for ${item.email}? Grants take effect immediately.`,
                )
              )
                return;
              setIsSaving(true);
              try {
                const saved = await onSave({
                  email: item.email,
                  name: item.name,
                  role,
                  outletIds,
                  permissions: role !== "MAIN_ADMIN" ? permissions : [],
                  ...(designationId && role !== "MAIN_ADMIN"
                    ? { designationId }
                    : {}),
                  active,
                });
                if (saved) setIsOpen(false);
              } finally {
                setIsSaving(false);
              }
            }}
          >
            {isSaving ? "Saving..." : "Save access"}
          </button>
        </div>
          </section>
        </div></ModalPortal>
        )}
      </div>
    );
  }

  function UserPasswordControl({ item }: { item: UserView }) {
    const [isOpen, setIsOpen] = useState(false);
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    function close() {
      setIsOpen(false);
      setPassword("");
      setConfirmPassword("");
      setShowPassword(false);
      setError("");
    }

    async function savePassword(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      setError("");
      setSuccess("");
      if (password !== confirmPassword) {
        setError("The passwords do not match.");
        return;
      }
      setBusy(true);
      try {
        await request(`/api/users/${item._id}/password`, {
          method: "PATCH",
          body: JSON.stringify({ password }),
        });
        setSuccess("Password changed. Share the new password securely.");
        setPassword("");
        setConfirmPassword("");
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to change password.",
        );
      } finally {
        setBusy(false);
      }
    }

    return (
      <>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => {
            setError("");
            setSuccess("");
            setIsOpen(true);
          }}
        >
          Password
        </button>
        {isOpen && (
          <ModalPortal><div className="access-modal-backdrop">
            <section
              className="access-modal user-password-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby={`user-password-title-${item._id}`}
            >
              <div className="access-modal-heading">
                <div>
                  <h2 id={`user-password-title-${item._id}`}>
                    Change account password
                  </h2>
                  <p>
                    {item.name} · {item.email}
                  </p>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Close password dialog"
                  onClick={close}
                >
                  <X size={18} />
                </button>
              </div>
              <p className="password-hash-note">
                Current password cannot be viewed: passwords are stored as
                secure one-way hashes. Set a new password below.
              </p>
              {error && <Notice error={error} success="" />}
              {success && <Notice error="" success={success} />}
              <form
                className="form-grid user-password-form"
                onSubmit={savePassword}
              >
                <label className="field">
                  <span>New password (at least 10 characters)</span>
                  <span className="password-input">
                    <input
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      minLength={10}
                      maxLength={72}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                    <button
                      className="password-toggle"
                      type="button"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      onClick={() => setShowPassword((visible) => !visible)}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </span>
                </label>
                <label className="field">
                  <span>Confirm new password</span>
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    minLength={10}
                    maxLength={72}
                    value={confirmPassword}
                    onChange={(event) =>
                      setConfirmPassword(event.target.value)
                    }
                    required
                  />
                </label>
                <div className="form-actions">
                  <button className="button button-primary" disabled={busy}>
                    {busy ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Check size={16} />
                    )}
                    Save new password
                  </button>
                </div>
              </form>
            </section>
          </div></ModalPortal>
        )}
      </>
    );
  }

  function EmployeeAttendanceTable({
    rows: providedRows,
    canReadSalary,
    globalFrom,
    globalTo,
    globalOutletId,
    outlets = [],
    canExport = false,
    exportBusy = null,
    onExport,
    title,
    description,
  }: {
    rows?: EmployeeAttendanceReportRow[];
    canReadSalary: boolean;
    globalFrom?: string;
    globalTo?: string;
    globalOutletId?: string;
    outlets?: Outlet[];
    canExport?: boolean;
    exportBusy?: ExportFormat | null;
    onExport?: (
      format: ExportFormat,
      filters: {
        from: string;
        to: string;
        outletId: string;
        employeeId: string;
      },
    ) => void;
    title: string;
    description: string;
  }) {
    const hasLocalFilters =
      globalFrom !== undefined && globalTo !== undefined;
    const [localFrom, setLocalFrom] = useState(globalFrom ?? "");
    const [localTo, setLocalTo] = useState(globalTo ?? "");
    const [localOutletId, setLocalOutletId] = useState(
      globalOutletId ?? "",
    );
    const [localEmployeeId, setLocalEmployeeId] = useState("");
    const report = useEmployeeAttendanceReport({
        enabled: hasLocalFilters,
        from: localFrom,
        to: localTo,
        outletId: localOutletId,
        employeeId: localEmployeeId,
      });
    const rows = providedRows ?? report.rows;
    const employees = report.employees;
    const isFetching = hasLocalFilters && report.isFetching;
    const error = hasLocalFilters ? report.error : "";

    return (
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          {hasLocalFilters && (
          <div className="toolbar dashboard-report-toolbar">
            <select
              aria-label="Attendance report outlet"
              value={localOutletId}
              onChange={(event) => {
                setLocalOutletId(event.target.value);
                setLocalEmployeeId("");
              }}
            >
              <option value="">All outlets</option>
              {outlets.map((outlet) => (
                <option key={outlet._id} value={outlet._id}>
                  {outlet.code} · {outlet.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Attendance report employee"
              value={localEmployeeId}
              onChange={(event) => setLocalEmployeeId(event.target.value)}
            >
              <option value="">All employees</option>
              {employees
                .filter(
                  (employee) =>
                    !localOutletId || employee.outletId === localOutletId,
                )
                .map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.code} · {employee.name}
                  </option>
                ))}
            </select>
            <input
              type="date"
              aria-label="Attendance report from date"
              value={localFrom}
              max={localTo}
              onChange={(event) => setLocalFrom(event.target.value)}
            />
            <input
              type="date"
              aria-label="Attendance report to date"
              value={localTo}
              min={localFrom}
              onChange={(event) => setLocalTo(event.target.value)}
            />
            {canExport && onExport && (
              <>
                <button
                  className="button button-secondary"
                  type="button"
                  aria-label="Download Excel"
                  disabled={
                    exportBusy !== null ||
                    localFrom > localTo ||
                    isFetching
                  }
                  onClick={() =>
                    onExport("xlsx", {
                      from: localFrom,
                      to: localTo,
                      outletId: localOutletId,
                      employeeId: localEmployeeId,
                    })
                  }
                >
                  {exportBusy === "xlsx" ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <FileSpreadsheet size={15} />
                  )}
                  Excel
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  aria-label="Download CSV"
                  disabled={
                    exportBusy !== null ||
                    localFrom > localTo ||
                    isFetching
                  }
                  onClick={() =>
                    onExport("csv", {
                      from: localFrom,
                      to: localTo,
                      outletId: localOutletId,
                      employeeId: localEmployeeId,
                    })
                  }
                >
                  {exportBusy === "csv" ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <FileText size={15} />
                  )}
                  CSV
                </button>
              </>
            )}
          </div>
          )}
        </div>
        <div className="dashboard-report-table-region" aria-busy={isFetching}>
          <div className="table-wrap">
            <table className="dashboard-employee-attendance">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Present</th>
                <th>Absent</th>
                <th>Half day</th>
                <th>Week off</th>
                <th>Filled days</th>
                <th>Not marked</th>
                {canReadSalary && <th>Fixed salary</th>}
                {canReadSalary && <th>Advances</th>}
                {canReadSalary && <th>Employee ESI</th>}
                {canReadSalary && <th>Employee PF</th>}
                {canReadSalary && <th>Employer PF</th>}
                {canReadSalary && <th>Original loan</th>}
                {canReadSalary && <th>Remaining balance</th>}
                {canReadSalary && <th>Monthly deduction</th>}
                {canReadSalary && <th>Payable</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.employeeId}>
                  <td>
                    <strong>{row.employeeName}</strong>
                    <span className="sub-cell">
                      {row.employeeCode} · {row.outletCode}
                    </span>
                    {Object.values(row.statusDates).some(
                      (dates) => dates.length > 0,
                    ) && (
                      <details className="attendance-date-details">
                        <summary>
                          <CalendarDays size={13} aria-hidden="true" />
                          Attendance dates
                          <span className="attendance-date-count">
                            {Object.values(row.statusDates).reduce(
                              (total, dates) => total + dates.length,
                              0,
                            )}
                          </span>
                          <ChevronRight
                            className="attendance-date-chevron"
                            size={13}
                            aria-hidden="true"
                          />
                        </summary>
                        <div className="attendance-date-groups">
                          {[
                            {
                              label: "Present",
                              tone: "present",
                              dates: row.statusDates.P,
                            },
                            {
                              label: "Absent",
                              tone: "absent",
                              dates: row.statusDates.A,
                            },
                            {
                              label: "Half day",
                              tone: "half-day",
                              dates: row.statusDates.HD,
                            },
                            {
                              label: "Week off",
                              tone: "week-off",
                              dates: row.statusDates.WO,
                            },
                          ]
                            .filter((group) => group.dates.length > 0)
                            .map((group) => (
                              <div
                                className={`attendance-date-group attendance-date-group-${group.tone}`}
                                key={group.label}
                              >
                                <strong>{group.label}</strong>
                                <div className="attendance-date-list">
                                  {group.dates.map((date) => (
                                    <time dateTime={date} key={date}>
                                      {date}
                                    </time>
                                  ))}
                                </div>
                              </div>
                            ))}
                        </div>
                      </details>
                    )}
                    {row.unsubmittedDays > 0 && (
                      <span className="sub-cell">
                        Pending submission: {row.unsubmittedDays} day(s)
                      </span>
                    )}
                  </td>
                  <td>{row.presentDays}</td>
                  <td>{row.absentDays}</td>
                  <td>{row.halfDays}</td>
                  <td>{row.weekOffs}</td>
                  <td>
                    {row.filledDays ??
                      row.presentDays +
                        row.absentDays +
                        row.halfDays +
                        row.weekOffs}
                  </td>
                  <td>{row.missingDays}</td>
                  {canReadSalary && (
                    <td>{currency(row.monthlyBaseSalary ?? 0)}</td>
                  )}
                  {canReadSalary && <td>{currency(row.advances ?? 0)}</td>}
                  {canReadSalary && <td>{currency(row.esi ?? 0)}</td>}
                  {canReadSalary && (
                    <td>{currency(row.employeePf ?? 0)}</td>
                  )}
                  {canReadSalary && (
                    <td>{currency(row.employerPf ?? 0)}</td>
                  )}
                  {canReadSalary && (
                    <td>{currency(row.originalLoanAmount ?? 0)}</td>
                  )}
                  {canReadSalary && (
                    <td>{currency(row.remainingLoanBalance ?? 0)}</td>
                  )}
                  {canReadSalary && (
                    <td>{currency(row.monthlyLoanDeduction ?? 0)}</td>
                  )}
                  {canReadSalary && (
                    <td>
                      {currency(row.payableAmount ?? 0)}
                      <span className="sub-cell">{row.payableLabel}</span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            </table>
          </div>
          {isFetching && (
            <div className="dashboard-report-loading" role="status">
              <RefreshSpinner />
              Updating attendance report
            </div>
          )}
          {error && (
            <div className="dashboard-report-error" role="alert">
              {error}
            </div>
          )}
          {!isFetching && !error && !rows.length && (
            <Empty>No employee attendance records match this period.</Empty>
          )}
        </div>
      </section>
    );
  }

  function ReportsPanel({ outlets }: { outlets: Outlet[] }) {
    const [kind, setKind] = useState("attendance");
    const [outletId, setOutletId] = useState("");
    const selectedOutletId =
      outlets.length === 1 ? outlets[0]._id : outletId;
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
    }).format(new Date());
    const monthStart = `${today.slice(0, 7)}-01`;
    const [from, setFrom] = useState(monthStart);
    const [to, setTo] = useState(today);
    const [preset, setPreset] = useState("This Month");
    const [busy, setBusy] = useState<ExportFormat | null>(null);
    const [error, setError] = useState("");
    const [employeeId, setEmployeeId] = useState("");
    const employeeReport = useEmployeeAttendanceReport({
      enabled: kind === "attendance",
      from,
      to,
      outletId: selectedOutletId,
      employeeId,
    });
    function applyPreset(value: string) {
      setPreset(value);
      if (value === "Custom") return;
      const end = new Date(`${today}T00:00:00.000Z`);
      const start = new Date(end);
      if (value === "Yesterday") start.setUTCDate(start.getUTCDate() - 1);
      if (value === "This Week")
        start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
      if (value === "This Month") start.setUTCDate(1);
      if (value === "Last Month") {
        start.setUTCDate(1);
        start.setUTCMonth(start.getUTCMonth() - 1);
        end.setUTCDate(0);
      }
      if (value === "This Year") {
        start.setUTCMonth(0, 1);
      }
      setFrom(start.toISOString().slice(0, 10));
      setTo(end.toISOString().slice(0, 10));
    }
    async function exportFile(format: ExportFormat) {
      setBusy(format);
      setError("");
      try {
        const params = new URLSearchParams({ type: kind, from, to, format });
        if (selectedOutletId) params.set("outletId", selectedOutletId);
        if (kind === "attendance" && employeeId)
          params.set("employeeId", employeeId);
        await downloadReport(
          `/api/reports/export?${params.toString()}`,
          format,
        );
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Report export failed.",
        );
      } finally {
        setBusy(null);
      }
    }
    return (
      <div className="content-area">
        <PageHead
          title="Reports & exports"
          description="Download permission-checked Excel and CSV reports from live records."
        />
        <Notice
          error={error || (kind === "attendance" ? employeeReport.error : "")}
          success=""
          refreshing={
            kind === "attendance" && employeeReport.isFetching
          }
        />
        <section className="panel report-panel">
          <div className="report-icon">
            <ArrowDownToLine size={22} />
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Date range</span>
              <select
                value={preset}
                onChange={(event) => applyPreset(event.target.value)}
              >
                {[
                  "Today",
                  "Yesterday",
                  "This Week",
                  "This Month",
                  "Last Month",
                  "This Year",
                  "Custom",
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Report</span>
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="attendance">Attendance</option>
                <option value="salary">Monthly salary</option>
                <option value="employees">Employee list</option>
                <option value="advances">Advances</option>
                <option value="audit">Audit log</option>
              </select>
            </label>
            <label className="field">
              <span>Outlet</span>
              <select
                value={selectedOutletId}
                onChange={(event) => {
                  setOutletId(event.target.value);
                  setEmployeeId("");
                }}
              >
                {outlets.length !== 1 && (
                  <option value="">All accessible outlets</option>
                )}
                {outlets.map((outlet) => (
                  <option key={outlet._id} value={outlet._id}>
                    {outlet.code} · {outlet.name}
                  </option>
                ))}
              </select>
            </label>
            {kind === "attendance" && (
              <label className="field">
                <span>Employee</span>
                <select
                  value={employeeId}
                  onChange={(event) => setEmployeeId(event.target.value)}
                >
                  <option value="">All employees</option>
                  {employeeReport.employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.code} · {employee.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <span>From</span>
              <input
                type="date"
                value={from}
                onChange={(event) => {
                  setPreset("Custom");
                  setFrom(event.target.value);
                }}
              />
            </label>
            <label className="field">
              <span>To</span>
              <input
                type="date"
                value={to}
                onChange={(event) => {
                  setPreset("Custom");
                  setTo(event.target.value);
                }}
              />
            </label>
          </div>
          <div className="toolbar">
            <button
              className="button button-primary"
              aria-label="Export Excel workbook"
              disabled={
                busy !== null ||
                from > to ||
                (kind === "attendance" && employeeReport.isFetching)
              }
              onClick={() => void exportFile("xlsx")}
            >
              {busy === "xlsx" ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <FileSpreadsheet size={16} />
              )}
              Excel
            </button>
            <button
              className="button button-secondary"
              aria-label="Export CSV file"
              disabled={
                busy !== null ||
                from > to ||
                (kind === "attendance" && employeeReport.isFetching)
              }
              onClick={() => void exportFile("csv")}
            >
              {busy === "csv" ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <FileText size={16} />
              )}
              CSV
            </button>
          </div>
        </section>
        {kind === "attendance" && (
          <div
            className="reports-attendance-results"
            aria-busy={employeeReport.isFetching}
          >
              {employeeReport.canReadSalary && (
                <p className="sub-cell">
                  Payable shows live accrued salary from submitted attendance for
                  the selected dates. Missing or unsubmitted days are not treated
                  as absences.
                </p>
              )}
              <AttendanceTrendChart
                rows={employeeReport.rows}
                from={from}
                to={to}
              />
              <EmployeeAttendanceTable
                rows={employeeReport.rows}
                canReadSalary={employeeReport.canReadSalary}
                title="Employee-wise attendance"
                description={`${formatDate(from)} to ${formatDate(to)} · Counts, status dates, and salary details when permitted.`}
              />
            {employeeReport.isFetching && (
              <div className="dashboard-report-loading" role="status">
                <RefreshSpinner />
                Updating attendance report
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  function SettingsPanel({
    data,
    loading,
    busy,
    error,
    success,
    user,
    onSave,
  }: {
    data?: Partial<SalarySettings>;
    loading: boolean;
    busy: boolean;
    error: string;
    success: string;
    user: { role: UserRole };
    onSave: (settings: Record<string, unknown>) => void;
  }) {
    const settings = data ?? {};
    if (loading)
      return (
        <div className="content-area">
          <PageHead
            title="Payroll settings"
            description="Configure salary calculation policy."
          />
          <Loading />
        </div>
      );
    return (
      <div className="content-area">
        <PageHead
          title="Payroll settings"
          description="Configure salary divisor, paid absences, and business timezone. Week-offs always receive full-day pay."
        />
        <Notice error={error} success={success} />
        <form
          className="panel settings-panel"
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            onSave({
              timezone: String(values.get("timezone") ?? ""),
              defaultSalaryMethod: "FIXED_30_DAYS",
              workingDaysDivisor: 30,
              paidAbsences: Number(values.get("paidAbsences")),
              currency: "INR",
              advanceDeductionPolicy: "UNPAID_ONLY",
            });
          }}
        >
          <div className="form-grid">
            <Field
              label="Business timezone"
              name="timezone"
              defaultValue={settings.timezone ?? "Asia/Kolkata"}
            />
            <label className="field">
              <span>Salary divisor</span>
              <input value="30 days (fixed)" readOnly />
            </label>
            <Field
              label="Paid absences per month"
              name="paidAbsences"
              type="number"
              min="0"
              max="31"
              defaultValue={String(settings.paidAbsences ?? 0)}
            />
          </div>
          <p className="policy-note">
            Present and week-off days receive full daily pay; half-days receive
            half and unpaid absences deduct a full day. PF is configured per
            employee. Approved advances are deducted once when payroll is
            generated. No statutory tax rules are assumed.
          </p>
          <button
            className="button button-primary"
            type="submit"
            disabled={user.role !== "MAIN_ADMIN" || busy}
          >
            <Check size={16} /> {busy ? "Saving..." : "Save settings"}
          </button>
        </form>
        {user.role === "MAIN_ADMIN" && <AdminCredentialsPanel />}
      </div>
    );
  }

  function AdminCredentialsPanel() {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    useEffect(() => {
      let cancelled = false;
      void request<{ username: string }>("/api/settings/admin-credentials")
        .then((result) => {
          if (!cancelled) setUsername(result.username);
        })
        .catch((caught) => {
          if (!cancelled)
            setError(
              caught instanceof Error
                ? caught.message
                : "Unable to load admin credentials.",
            );
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, []);

    async function save(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      setError("");
      setSuccess("");
      if (password !== confirmPassword) {
        setError("The passwords do not match.");
        return;
      }
      setBusy(true);
      try {
        const result = await request<{ username: string }>(
          "/api/settings/admin-credentials",
          {
            method: "PUT",
            body: JSON.stringify({ username, password: password || undefined }),
          },
        );
        setUsername(result.username);
        setPassword("");
        setConfirmPassword("");
        setSuccess(
          password
            ? "Admin username and password updated in MongoDB."
            : "Admin username updated in MongoDB.",
        );
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to update admin credentials.",
        );
      } finally {
        setBusy(false);
      }
    }

    return (
      <section className="panel credential-panel">
        <div className="panel-heading">
          <div>
            <h2>Admin login credentials</h2>
            <p>Update the username and password used to sign in.</p>
          </div>
        </div>
        {error && <Notice error={error} success="" />}
        {success && <Notice error="" success={success} />}
        {loading ? (
          <Loading />
        ) : (
          <form className="form-grid" onSubmit={save}>
            <label className="field">
              <span>Admin username or email</span>
              <input
                name="admin-username"
                type="text"
                autoComplete="username"
                maxLength={254}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>New password (optional; at least 10 characters, up to 1024)</span>
              <span className="password-input">
                <input
                  name="admin-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  minLength={10}
                  maxLength={1024}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  className="password-toggle"
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </label>
            <label className="field">
              <span>Confirm new password</span>
              <input
                name="confirm-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={10}
                maxLength={1024}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            <div className="credential-actions">
              <button
                className="button button-primary"
                type="submit"
                disabled={busy}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Check size={16} />
                )}
                Save admin credentials
              </button>
            </div>
          </form>
        )}
      </section>
    );
  }
