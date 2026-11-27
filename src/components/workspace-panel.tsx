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
  import dynamic from "next/dynamic";
  import { createPortal } from "react-dom";
  import { RoundedSelect } from "@/components/rounded-select";
  import {
    ArrowUpRight,
    Bell,
    Banknote,
    Building2,
    BriefcaseBusiness,
    CalendarDays,
    CalendarClock,
    Check,
    ChevronDown,
    ClipboardCheck,
    CircleCheck,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    Clock3,
    Eye,
    EyeOff,
    FileSpreadsheet,
    FileText,
    Info,
    HandCoins,
    LoaderCircle,
    Plus,
    Printer,
    RefreshCw,
    Search,
    Send,
    SlidersHorizontal,
    Trash2,
    Users,
    X,
  } from "lucide-react";
  import type {
    AttendanceStatus,
    Permission,
    SalarySettings,
    UniformItemKey,
    UserRole,
  } from "@/lib/models";
  import type {
    AttendanceCounts,
    AdvanceView,
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
    designationOnlyPermissionSet,
    legacyOutletDefaultPermissions,
  } from "@/lib/access-control";
  import { useEmployeeAttendanceReport } from "@/lib/use-employee-attendance-report";
  import { clientRequestCache } from "@/lib/client-request-cache";
  import { fetchOutletList } from "@/lib/outlets-client";
  import { moveOutletOrder } from "@/lib/outlet-order";
  import { getEmployeeCodePrefix } from "@/lib/employee-code";
  import { EmployeeImportPanel } from "@/components/employee-import-panel";
  import { EmployeeCreatePanel } from "@/components/employee-create-panel";
  import {
    EmployeeDetail,
    prefetchEmployeeDetail,
  } from "@/components/employee-detail";
  import { AutoDismissNotice } from "@/components/auto-dismiss-notice";
  import { LazySection } from "@/components/lazy-section";
  import { DashboardPartLoader } from "@/components/dashboard-part-loader";
  import { dateAfter, getIndiaDate, getIndiaMonth } from "@/lib/payroll/dates";
  import { isAttendanceEntryLocked } from "@/lib/attendance";
  import {
    calculateLoanInstallment,
    calculateNetPayable,
  } from "@/lib/payroll/calculate";
  import { UNIFORM_ITEM_LABELS } from "@/lib/uniform-deductions";
  import {
    expectedCompletionMonth,
    loanScheduleSummary,
  } from "@/lib/payroll/loans";
  import { formatDate, formatDateTime } from "@/lib/date-format";

  const RechartsLoading = () => (
    <div className="panel chart-panel chart-area" role="status" aria-busy="true">
      Loading chart…
    </div>
  );

  const AttendanceStatusChart = dynamic(
    () =>
      import("@/components/workspace-recharts").then(
        (module) => module.AttendanceStatusChart,
      ),
    { loading: RechartsLoading },
  );
  const AttendanceTrendChart = dynamic(
    () =>
      import("@/components/workspace-recharts").then(
        (module) => module.AttendanceTrendChart,
      ),
    { loading: RechartsLoading },
  );

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
  type AttendanceSearchSuggestion = {
    kind: "employee" | "outlet" | "designation";
    id: string;
    label: string;
    detail: string;
  };
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

  function dashboardPercentClass(value: number, prefix: "dashboard-width") {
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
    if ((init?.method ?? "GET").toUpperCase() !== "GET") {
      const pathname = url.split("?")[0];
      if (pathname.startsWith("/api/outlets"))
        clientRequestCache.invalidateUrl("/api/outlets");
      if (pathname.startsWith("/api/designations"))
        clientRequestCache.invalidateUrl("/api/designations");
    }
    return payload as T;
  }

  async function fetchAllEmployees(signal?: AbortSignal): Promise<EmployeeView[]> {
    const pageSize = 100;
    const firstPage = await request<WorkspaceData>(
      `/api/employees?page=1&pageSize=${pageSize}`,
      { signal },
    );
    const total = firstPage.total ?? firstPage.employees?.length ?? 0;
    const remainingPages = await Promise.all(
      Array.from(
        { length: Math.max(0, Math.ceil(total / pageSize) - 1) },
        (_, index) =>
          request<WorkspaceData>(
            `/api/employees?page=${index + 2}&pageSize=${pageSize}`,
            { signal },
          ),
      ),
    );
    return [firstPage, ...remainingPages].flatMap(
      (page) => page.employees ?? [],
    );
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

  function formatReportDate(value: string) {
    const [year, month, day] = value.split("-");
    return year && month && day ? `${day}/${month}/${year}` : "";
  }

  function parseReportDate(value: string) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    if (!match) return "";
    const [, day, month, year] = match;
    const dayNumber = Number(day);
    const monthNumber = Number(month);
    const yearNumber = Number(year);
    const daysInMonth = [
      31,
      yearNumber % 4 === 0 &&
      (yearNumber % 100 !== 0 || yearNumber % 400 === 0)
        ? 29
        : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31,
    ];
    if (
      yearNumber < 1 ||
      monthNumber < 1 ||
      monthNumber > 12 ||
      dayNumber < 1 ||
      dayNumber > daysInMonth[monthNumber - 1]
    )
      return "";
    return `${year}-${month}-${day}`;
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
          <LoaderCircle className="spin" size={16} aria-hidden="true" />
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
    const [outletsLoaded, setOutletsLoaded] = useState(false);
    const activeOutlets = (outlets ?? []).filter((outlet) => outlet.active);
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
    const activeReloadController = useRef<AbortController | null>(null);
    const [
      attendanceAllPresentSnapshot,
      setAttendanceAllPresentSnapshot,
    ] = useState<{
      scope: string;
      previousStatuses: Map<string, AttendanceStatus | null>;
    } | null>(null);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(
      null,
    );
    const [employeeToApprove, setEmployeeToApprove] =
      useState<Employee | null>(null);
    const [advanceToDelete, setAdvanceToDelete] =
      useState<AdvanceView | null>(null);
    const [isApproveAllConfirmationOpen, setIsApproveAllConfirmationOpen] =
      useState(false);
    const [employeeToEdit, setEmployeeToEdit] = useState<Employee | null>(null);
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
    const [awayPeriod, setAwayPeriod] = useState("LAST_WEEK");
    const [awayFrom, setAwayFrom] = useState(() => `${getIndiaMonth()}-01`);
    const [awayTo, setAwayTo] = useState(() => getIndiaDate());
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [attendanceSearch, setAttendanceSearch] = useState("");
    const [attendanceSearchSelection, setAttendanceSearchSelection] =
      useState<AttendanceSearchSuggestion | null>(null);
    const [attendanceSearchOpen, setAttendanceSearchOpen] = useState(false);
    const [attendancePage, setAttendancePage] = useState(1);
    const [page, setPage] = useState(1);
    const [salaryPage, setSalaryPage] = useState(1);
    const [salaryPageSize, setSalaryPageSize] = useState<number | "all">(20);
    const [salarySearch, setSalarySearch] = useState("");
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
    const reloadKey = (() => {
      switch (section) {
        case "dashboard":
          return JSON.stringify([
            dashboardDate,
            dashboardFrom,
            dashboardTo,
            awayPeriod,
            awayFrom,
            awayTo,
            selectedOutlet,
            dashboardRefreshKey,
          ]);
        case "attendance":
          return JSON.stringify([date, attendanceOutletId, attendanceOutlets.length]);
        case "employees":
          return JSON.stringify([page, debouncedSearch, selectedOutlet, user.role]);
        case "advances":
          return JSON.stringify([page, advanceStatus, selectedOutlet]);
        case "loans":
        case "salary":
          return JSON.stringify([month, selectedOutlet]);
        case "activeLogs":
          return selectedOutlet;
        default:
          return "initial";
      }
    })();

    async function reload(signal?: AbortSignal) {
      if (!signal) {
        activeReloadController.current?.abort();
        const controller = new AbortController();
        activeReloadController.current = controller;
        signal = controller.signal;
      }
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
          const dashboard = await request<WorkspaceData>(dashboardUrl, { signal });
          commitData(dashboard);
        }
        if (section === "attendance") {
          if (attendanceOutletId) {
            const attendanceData = await request<WorkspaceData>(
                `/api/attendance?outletId=${attendanceOutletId}&date=${date}`,
                { signal },
              );
            commitData(attendanceData);
          } else if (attendanceOutlets.length > 1) {
            const attendanceData = await request<WorkspaceData>(
              `/api/attendance?date=${date}`,
              { signal },
            );
            commitData(attendanceData);
          } else if (reloadId === attendanceReloadId.current) {
            commitData({});
          }
        }
        if (section === "employees")
          commitData(
            await request<WorkspaceData>(
              `/api/employees?page=${page}&pageSize=20&q=${encodeURIComponent(debouncedSearch)}${selectedOutlet ? `&outletId=${selectedOutlet}` : ""}${user.role === "MAIN_ADMIN" ? "&active=all" : ""}`,
              { signal },
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
              { signal },
            ),
            fetchAllEmployees(signal),
            clientRequestCache
              .get(user.email, "/api/outlets", 120_000, fetchOutletList)
              .catch((caught: unknown) => {
                if (!signal?.aborted)
                  setError(
                    caught instanceof Error
                      ? caught.message
                      : "Unable to load outlets.",
                  );
                return [];
              }),
          ]);
          commitData({
            ...advances,
            employees,
            outlets,
          });
        }
        if (section === "loans")
          commitData(
            await request<WorkspaceData>(
              `/api/loans?month=${month}${selectedOutlet ? `&outletId=${selectedOutlet}` : ""}`,
              { signal },
            ),
          );
        if (section === "salary" && month)
          commitData(
            await request<WorkspaceData>(
              `/api/payroll?month=${month}${selectedOutlet ? `&outletId=${selectedOutlet}` : ""}`,
              { signal },
            ),
          );
        if (section === "outlets") {
          const outletData = await clientRequestCache.get(
            user.email,
            "/api/outlets",
            120_000,
            fetchOutletList,
          );
          const refreshedOutlets = outletData;
          if (reloadId === attendanceReloadId.current) {
            setData({ outlets: outletData });
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
            request<WorkspaceData>("/api/users", { signal }),
            clientRequestCache.get(
              user.email,
              "/api/designations",
              300_000,
              () =>
                request<{ designations: DesignationView[] }>(
                  "/api/designations",
                ),
            ),
          ]);
          commitData({ ...users, designations: designations.designations });
        }
        if (section === "activeLogs") {
          const params = new URLSearchParams({ page: "0" });
          if (selectedOutlet) params.set("outletId", selectedOutlet);
          commitData(
            await request<WorkspaceData>(
              `/api/audit?${params.toString()}`,
              { signal },
            ),
          );
        }
        if (section === "settings")
          commitData(await request<WorkspaceData>("/api/settings", { signal }));
      } catch (caught) {
        if (!signal.aborted && reloadId === attendanceReloadId.current) {
          if (section === "outlets") setOutlets([]);
          setError(
            caught instanceof Error ? caught.message : "Unable to load records.",
          );
        }
      } finally {
        if (!signal.aborted && reloadId === attendanceReloadId.current) {
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
      void clientRequestCache.get(
        user.email,
        "/api/outlets",
        120_000,
        fetchOutletList,
      )
        .then((result) => {
          if (cancelled) return;
          setOutlets(result);
          const accessibleActiveOutlets = result.filter(
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
          if (!cancelled) {
            setOutlets([]);
            setError(
              caught instanceof Error
                ? caught.message
                : "Unable to load outlets.",
            );
          }
        })
        .finally(() => {
          if (!cancelled) setOutletsLoaded(true);
        });
      return () => {
        cancelled = true;
      };
    }, [user.email]);
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
      if (!outletsLoaded) return;
      const timer = window.setTimeout(() => reloadCurrentView(), 0);
      return () => {
        window.clearTimeout(timer);
        activeReloadController.current?.abort();
      };
    }, [section, reloadKey, outletsLoaded]);

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
      if (value === "Yesterday") {
        start.setUTCDate(start.getUTCDate() - 1);
        end.setUTCDate(end.getUTCDate() - 1);
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
        if (formData.has("outletIds")) {
          const outletIds = formData.getAll("outletIds").map(String);
          body.outletIds =
            url === "/api/users" && outletIds.includes("__ALL_OUTLETS__")
              ? activeOutlets.map((outlet) => outlet._id)
              : outletIds;
        }
        if (formData.has("permissions"))
          body.permissions = formData.getAll("permissions").map(String);
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
      <RoundedSelect
        value={selectedOutlet}
        onChange={(event) => {
          setSelectedOutlet(event.target.value);
          setSalaryPage(1);
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
      </RoundedSelect>
    );
    const toolbar = (
      <div
        className={`toolbar${section === "advances" ? " advances-toolbar" : ""}`}
      >
        {outletSelect}
        {section === "dashboard" && (
          <>
            <RoundedSelect
              aria-label="Dashboard reporting period"
              value={dashboardPreset}
              onChange={(event) => applyDashboardPreset(event.target.value)}
            >
              <option>This Month</option>
              <option>Last Month</option>
              <option>Today</option>
              <option>Yesterday</option>
              <option>Custom</option>
            </RoundedSelect>
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
                    <span>Net payroll · all employees</span>
                    <span className="dashboard-kpi-icon dashboard-kpi-rose"><Banknote size={17} /></span>
                  </div>
                  <strong>{data.metrics?.netPayable == null ? "—" : currency(data.metrics.netPayable)}</strong>
                  <div className="dashboard-kpi-foot">
                    <span>{data.metrics?.netPayable == null ? "Salary permission required" : `After attendance and deductions through ${formatDate(dashboardDate)}`}</span>
                    {user.permissions.includes("salary.read") && <Link href="/salary" className="dashboard-kpi-link">View payroll <ArrowUpRight size={13} /></Link>}
                  </div>
                  {data.metrics?.approvedAdvancesPendingPayroll != null && (
                    <div className="dashboard-kpi-extra">Approved advances <strong>{currency(data.metrics.approvedAdvancesPendingPayroll)}</strong></div>
                  )}
                  {data.metrics?.netPayable != null && (
                    <div className="dashboard-kpi-extra">Net pay after advances &amp; deductions <strong>{currency(data.metrics.netPayable)}</strong></div>
                  )}
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
                    <span>Attendance submissions</span>
                  </div>
                  <div className="dashboard-submission-content">
                    <div>
                      <strong>{dashboardSubmittedOutlets}<span> of {dashboardActiveOutlets}</span></strong>
                      <small>outlets submitted for selected date</small>
                    </div>
                    <ClipboardCheck
                      className="dashboard-submission-icon"
                      size={42}
                      strokeWidth={1.6}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="dashboard-kpi-foot">
                    <span>
                      {data.metrics?.missingSubmissions ?? 0}{" "}
                      {data.metrics?.missingSubmissions === 1
                        ? "outlet still needs to submit"
                        : "outlets still need to submit"}
                    </span>
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
                        accrualDate={dashboardDate}
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
                    paginate
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
    const normalizedAttendanceSearch = attendanceSearch.trim().toLowerCase();
    const matchesAttendanceSearch = (employee: Employee) =>
      [
        employee.fullName,
        employee.employeeCode,
        employee.outletCode,
        employee.outletName,
        employee.designation,
      ].some((value) => value?.toLowerCase().includes(normalizedAttendanceSearch));
    const matchingAttendanceEmployees = normalizedAttendanceSearch
      ? attendanceEmployees.filter(matchesAttendanceSearch)
      : [];
    const attendanceOutletsForSearch = [
      ...new Map(
        attendanceEmployees.map((employee) => [
          employee.outletId,
          {
            id: employee.outletId,
            code: employee.outletCode ?? "",
            name: employee.outletName ?? "",
          },
        ]),
      ).values(),
    ];
    const attendanceDesignations = [
      ...new Set(
        attendanceEmployees
          .map((employee) => employee.designation)
          .filter(Boolean),
      ),
    ];
    const attendanceSearchSuggestions: AttendanceSearchSuggestion[] =
      normalizedAttendanceSearch
        ? [
            ...matchingAttendanceEmployees.slice(0, 5).map((employee) => ({
              kind: "employee" as const,
              id: employee._id,
              label: employee.fullName,
              detail: [
                employee.employeeCode,
                employee.outletCode,
                employee.outletName,
                employee.designation,
              ]
                .filter(Boolean)
                .join(" · "),
            })),
            ...attendanceOutletsForSearch
              .filter((outlet) =>
                [outlet.code, outlet.name].some((value) =>
                  value.toLowerCase().includes(normalizedAttendanceSearch),
                ),
              )
              .slice(0, 2)
              .map((outlet) => ({
                kind: "outlet" as const,
                id: outlet.id,
                label: `${outlet.code} · ${outlet.name}`,
                detail: "Filter this outlet",
              })),
            ...attendanceDesignations
              .filter((designation) =>
                designation.toLowerCase().includes(normalizedAttendanceSearch),
              )
              .slice(0, 2)
              .map((designation) => ({
                kind: "designation" as const,
                id: designation,
                label: designation,
                detail: "Filter this designation",
              })),
          ].slice(0, 8)
        : [];
    const visibleAttendanceEmployees = attendanceSearchSelection
      ? attendanceEmployees.filter((employee) => {
          if (attendanceSearchSelection.kind === "employee")
            return employee._id === attendanceSearchSelection.id;
          if (attendanceSearchSelection.kind === "outlet")
            return employee.outletId === attendanceSearchSelection.id;
          return employee.designation === attendanceSearchSelection.id;
        })
      : normalizedAttendanceSearch
        ? matchingAttendanceEmployees
        : attendanceEmployees;
    const attendancePageSize = 50;
    const attendancePageCount = Math.max(
      1,
      Math.ceil(visibleAttendanceEmployees.length / attendancePageSize),
    );
    const currentAttendancePage = Math.min(attendancePage, attendancePageCount);
    const attendancePageEmployees = visibleAttendanceEmployees.slice(
      (currentAttendancePage - 1) * attendancePageSize,
      currentAttendancePage * attendancePageSize,
    );
    const attendanceAllPresentScope = `${date}:${attendanceOutletId || "all"}:${visibleAttendanceEmployees.map((employee) => employee._id).join(",")}`;
    const canUndoAttendanceAllPresent =
      attendanceAllPresentSnapshot?.scope === attendanceAllPresentScope;
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
        <div className="content-area attendance-content-area">
          <PageHead
            className="attendance-page-head"
            title="Daily attendance"
            description="Review all outlets or choose one outlet to record attendance. Submit locks marked employees; blank employees remain editable."
            action={
              <div className="toolbar attendance-toolbar">
                <div className="attendance-search-control">
                  <label className="attendance-search-field">
                    <Search size={16} aria-hidden="true" />
                    <input
                      type="text"
                      role="combobox"
                      aria-autocomplete="list"
                      value={attendanceSearch}
                      placeholder="Search name, code, outlet, designation…"
                      aria-label="Search attendance employees"
                      aria-expanded={
                        attendanceSearchOpen && normalizedAttendanceSearch.length > 0
                      }
                      aria-controls="attendance-search-suggestions"
                      onFocus={() => setAttendanceSearchOpen(true)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape")
                          setAttendanceSearchOpen(false);
                      }}
                      onChange={(event) => {
                        setAttendanceSearch(event.target.value);
                        setAttendanceSearchSelection(null);
                        setAttendancePage(1);
                        setAttendanceSearchOpen(true);
                      }}
                    />
                    {!!attendanceSearch && (
                      <button
                        type="button"
                        aria-label="Clear attendance search"
                        onClick={() => {
                          setAttendanceSearch("");
                          setAttendanceSearchSelection(null);
                          setAttendancePage(1);
                          setAttendanceSearchOpen(false);
                        }}
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    )}
                  </label>
                  {attendanceSearchOpen && normalizedAttendanceSearch && (
                    <div
                      id="attendance-search-suggestions"
                      className="attendance-search-suggestions"
                      role="listbox"
                      aria-label="Attendance search suggestions"
                    >
                      {attendanceSearchSuggestions.length ? (
                        attendanceSearchSuggestions.map((suggestion) => (
                          <button
                            key={`${suggestion.kind}:${suggestion.id}`}
                            type="button"
                            role="option"
                            aria-selected={false}
                            onClick={() => {
                              setAttendanceSearchSelection(suggestion);
                              setAttendanceSearch(suggestion.label);
                              setAttendancePage(1);
                              setAttendanceSearchOpen(false);
                            }}
                          >
                            <strong>{suggestion.label}</strong>
                            <span>{suggestion.detail}</span>
                          </button>
                        ))
                      ) : (
                        <span className="attendance-search-empty">
                          No matching employees
                        </span>
                      )}
                    </div>
                  )}
                </div>
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
                <div className="attendance-date-controls">
                  <button
                    type="button"
                    className="attendance-date-nav"
                    aria-label="Previous day"
                    title="Previous day"
                    onClick={() => {
                      setDate(dateAfter(date, -1));
                      setAttendancePage(1);
                    }}
                  >
                    <ChevronLeft size={17} aria-hidden="true" />
                  </button>
                  <label className="attendance-date-picker">
                    <span>{formatDate(date)}</span>
                    <CalendarDays size={16} aria-hidden="true" />
                    <input
                      type="date"
                      value={date}
                      max={today}
                      onChange={(event) => {
                        if (event.target.value && event.target.value <= today) {
                          setDate(event.target.value);
                          setAttendancePage(1);
                        }
                      }}
                      aria-label="Attendance date"
                    />
                  </label>
                  <button
                    type="button"
                    className="attendance-date-nav"
                    aria-label="Next day"
                    title="Next day"
                    disabled={dateAfter(date, 1) > today}
                    onClick={() => {
                      setDate(dateAfter(date, 1));
                      setAttendancePage(1);
                    }}
                  >
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                </div>
                {attendanceOutlets.length === 1 ? (
                  <span className="attendance-single-outlet">
                    {attendanceOutlets[0].name}
                  </span>
                ) : attendanceOutlets.length > 1 ? (
                  <div className="attendance-outlet-select">
                    <RoundedSelect
                      value={selectedOutlet}
                      onChange={(event) => {
                        setSelectedOutlet(event.target.value);
                        setAttendancePage(1);
                      }}
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
                    </RoundedSelect>
                  </div>
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
              <div className="table-wrap attendance-table-wrap">
                <table>
                  <thead>
                    <tr>
                      {attendanceAllOutlets && <th>Outlet</th>}
                      <th>Employee</th>
                      <th>Designation</th>
                      <th>
                        <div className="attendance-status-heading">
                          <span>Status</span>
                          <button
                            type="button"
                            className="attendance-all-present"
                            aria-pressed={canUndoAttendanceAllPresent}
                            disabled={
                              !user.permissions.includes("attendance.write") ||
                              !visibleAttendanceEmployees.some(
                                (employee) =>
                                  !isAttendanceEntryLocked(
                                    !!employee.attendanceSubmitted,
                                    user.role,
                                  ),
                              )
                            }
                            onClick={() => {
                              const snapshot = attendanceAllPresentSnapshot;
                              if (snapshot?.scope === attendanceAllPresentScope) {
                                setData((old) => ({
                                  ...old,
                                  employees: (old.employees ?? []).map(
                                    (employee) => {
                                      const previousStatus =
                                        snapshot.previousStatuses.get(
                                          employee._id,
                                        );
                                      if (
                                        previousStatus === undefined &&
                                        !snapshot.previousStatuses.has(
                                          employee._id,
                                        )
                                      )
                                        return employee;
                                      if (
                                        isAttendanceEntryLocked(
                                          !!employee.attendanceSubmitted,
                                          user.role,
                                        )
                                      )
                                        return employee;
                                      return {
                                        ...employee,
                                        attendanceStatus: previousStatus ?? null,
                                      };
                                    },
                                  ),
                                }));
                                setAttendanceAllPresentSnapshot(null);
                                return;
                              }
                              const editableEmployees =
                                visibleAttendanceEmployees.filter(
                                  (employee) =>
                                    !isAttendanceEntryLocked(
                                      !!employee.attendanceSubmitted,
                                      user.role,
                                    ),
                                );
                              setAttendanceAllPresentSnapshot({
                                scope: attendanceAllPresentScope,
                                previousStatuses: new Map(
                                  editableEmployees.map((employee) => [
                                    employee._id,
                                    employee.attendanceStatus ?? null,
                                  ]),
                                ),
                              });
                              const editableEmployeeIds = new Set(
                                editableEmployees.map((employee) => employee._id),
                              );
                              setData((old) => ({
                                ...old,
                                employees: (old.employees ?? []).map((employee) =>
                                  editableEmployeeIds.has(employee._id)
                                    ? { ...employee, attendanceStatus: "P" }
                                    : employee,
                                ),
                              }));
                            }}
                          >
                            {canUndoAttendanceAllPresent ? "Undo P" : "All P"}
                          </button>
                        </div>
                      </th>
                      <th>Submission Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendancePageEmployees.map((employee: Employee) => (
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
                          {(employee.punchInAt || employee.punchOutAt) && (
                            <span className="sub-cell">
                              {employee.punchInAt &&
                                `In ${new Date(employee.punchInAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`}
                              {employee.punchInAt && employee.punchOutAt && " · "}
                              {employee.punchOutAt &&
                                `Out ${new Date(employee.punchOutAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`}
                            </span>
                          )}
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
                {!!data.employees?.length &&
                  !visibleAttendanceEmployees.length && (
                    <Empty>No employees match this search.</Empty>
                  )}
              </div>
              <div className="panel-footer attendance-panel-footer">
                {visibleAttendanceEmployees.length > attendancePageSize && (
                  <div className="attendance-footer-pagination">
                    <span>
                      Showing {(currentAttendancePage - 1) * attendancePageSize + 1}
                      –{Math.min(
                        currentAttendancePage * attendancePageSize,
                        visibleAttendanceEmployees.length,
                      )}{" "}
                      of {visibleAttendanceEmployees.length} employees
                    </span>
                    <div className="pagination">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Previous attendance page"
                        title="Previous page"
                        disabled={currentAttendancePage <= 1}
                        onClick={() =>
                          setAttendancePage(currentAttendancePage - 1)
                        }
                      >
                        <ChevronLeft size={17} />
                      </button>
                      <span>
                        {currentAttendancePage} / {attendancePageCount}
                      </span>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Next attendance page"
                        title="Next page"
                        disabled={currentAttendancePage >= attendancePageCount}
                        onClick={() =>
                          setAttendancePage(currentAttendancePage + 1)
                        }
                      >
                        <ChevronRight size={17} />
                      </button>
                    </div>
                  </div>
                )}
                <span className="attendance-marked-count">
                  {markedAttendanceCount} of {attendanceEmployees.length} marked
                </span>
                <div className="toolbar">
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
          versions: Array<{ employeeId: string; updatedAt: string | null }>;
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
          versions: [],
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
        group.versions.push({
          employeeId: employee._id,
          updatedAt: employee.attendanceEntryUpdatedAt ?? null,
        });
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
      const failedEmployees: string[] = [];
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
            const result = await request<{
              savedEmployeeCount: number;
              submittedEmployeeCount: number;
              failures: Array<{
                employeeId: string;
                employeeName: string;
                reason: string;
              }>;
            }>("/api/attendance", {
              method: "PUT",
              body: JSON.stringify({
                outletId,
                date,
                ...group,
                action: outletAction,
                reason,
              }),
            });
            if (result.savedEmployeeCount > 0) {
              if (result.submittedEmployeeCount > 0) submittedOutlets += 1;
              else draftOutlets += 1;
            }
            failedEmployees.push(
              ...result.failures.map(
                (failure) =>
                  `${outlet?.code ?? outletId}: ${failure.employeeName}: ${failure.reason}`,
              ),
            );
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
        if (failedOutlets.length || failedEmployees.length) {
          setError(
            `${submittedOutlets} outlet(s) submitted and ${draftOutlets} draft(s) saved; ${failedOutlets.length + failedEmployees.length} failed. ${[...failedOutlets, ...failedEmployees].join(" ")}`,
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

    async function setEmployeeActive(employee: Employee, active: boolean) {
      if (
        !active &&
        !window.confirm(
          `Deactivate ${employee.fullName}? Historical attendance, payroll, advances, and loans will remain.`,
        )
      )
        return;
      await mutate(
        `/api/employees/${employee._id}`,
        { active },
        "PATCH",
        active ? "Employee activated." : "Employee deactivated.",
      );
    }

    async function processEmployeeApproval(
      action: "APPROVE" | "REJECT",
      formData?: FormData,
    ) {
      if (!employeeToApprove) return;
      if (
        action === "REJECT" &&
        !window.confirm(
          `Reject the employee request for ${employeeToApprove.fullName}?`,
        )
      )
        return;
      setBusy(true);
      setError("");
      setSuccess("");
      try {
        await request(`/api/employees/${employeeToApprove._id}/approval`, {
          method: "POST",
          body: JSON.stringify(
            action === "APPROVE"
              ? {
                  action,
                  monthlyBaseSalary: Number(
                    formData?.get("monthlyBaseSalary"),
                  ),
                  salaryMethod: formData?.get("salaryMethod"),
                  pfEnabled: formData?.get("pfEnabled") === "true",
                  employeePfPercent: Number(
                    formData?.get("employeePfPercent"),
                  ),
                  employerPfPercent: Number(
                    formData?.get("employerPfPercent"),
                  ),
                  esiEnabled: formData?.get("esiEnabled") === "true",
                  esiPercent: Number(formData?.get("esiPercent")),
                }
              : { action },
          ),
        });
        setEmployeeToApprove(null);
        setSuccess(
          action === "APPROVE"
            ? "Employee request approved."
            : "Employee request rejected.",
        );
        await reload();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to process the employee request.",
        );
      } finally {
        setBusy(false);
      }
    }

    async function deleteEmployee() {
      if (!employeeToDelete) return;
      const deleted = await mutate(
        `/api/employees/${employeeToDelete._id}`,
        undefined,
        "DELETE",
        "Employee permanently deleted. Historical records remain.",
      );
      if (deleted) setEmployeeToDelete(null);
    }

    async function deleteAdvance() {
      if (!advanceToDelete) return;
      const deleted = await mutate(
        `/api/advances/${advanceToDelete._id}`,
        undefined,
        "DELETE",
        "Advance deleted.",
      );
      if (deleted) setAdvanceToDelete(null);
    }

    async function approveAllAdvances() {
      setBusy(true);
      setError("");
      setSuccess("");
      try {
        const result = await request<{ approvedCount: number }>(
          "/api/advances/bulk-approve",
          {
            method: "POST",
            body: JSON.stringify({
              ...(selectedOutlet ? { outletId: selectedOutlet } : {}),
            }),
          },
        );
        setIsApproveAllConfirmationOpen(false);
        setSuccess(
          result.approvedCount
            ? `${result.approvedCount} pending advance(s) approved.`
            : "There are no pending advances to approve.",
        );
        await reload();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to approve pending advances.",
        );
      } finally {
        setBusy(false);
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
              canManageUniforms={user.permissions.includes("uniforms.manage")}
              canManageShift={user.permissions.includes("employees.shift.manage")}
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
              rowClassNames={(data.employees ?? []).map((employee: Employee) =>
                employee.approvalStatus === "PENDING"
                  ? ""
                  : employee.active
                    ? ""
                    : "employee-inactive-row",
              )}
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
                const approvalPending =
                  employee.approvalStatus === "PENDING";
                cells.push(
                  <span
                    key="status"
                    className={`badge ${approvalPending ? "badge-amber" : employee.active ? "badge-green" : "badge-muted"}`}
                  >
                    {approvalPending
                      ? "Pending approval"
                      : employee.approvalStatus === "REJECTED"
                        ? "Rejected"
                        : employee.active
                          ? "Active"
                          : "Inactive"}
                  </span>,
                );
                cells.push(
                  user.role === "MAIN_ADMIN" ||
                    user.permissions.includes("employees.update") ? (
                    <span key="actions" className="employee-row-actions">
                      {user.role === "MAIN_ADMIN" && approvalPending && (
                        <button
                          type="button"
                          className="button button-small button-primary"
                          onClick={() => {
                            setError("");
                            setEmployeeToApprove(employee);
                          }}
                        >
                          Review &amp; approve
                        </button>
                      )}
                      {user.permissions.includes("employees.update") &&
                        !(
                          user.role === "OUTLET_USER" &&
                          approvalPending
                        ) && (
                        <button
                          type="button"
                          className="button button-small"
                          onMouseEnter={() =>
                            prefetchEmployeeDetail(
                              employee._id,
                              user.role !== "OUTLET_USER",
                              user.email,
                            )
                          }
                          onFocus={() =>
                            prefetchEmployeeDetail(
                              employee._id,
                              user.role !== "OUTLET_USER",
                              user.email,
                            )
                          }
                          onClick={() => {
                            prefetchEmployeeDetail(
                              employee._id,
                              user.role !== "OUTLET_USER",
                              user.email,
                            );
                            setEmployeeToEdit(employee);
                          }}
                        >
                          Edit
                        </button>
                      )}
                      {user.role === "MAIN_ADMIN" && (
                        <>
                          {!approvalPending &&
                            employee.approvalStatus !== "REJECTED" && (
                            <button
                              type="button"
                              className="button button-small"
                              disabled={busy}
                              onClick={() =>
                                void setEmployeeActive(
                                  employee,
                                  !employee.active,
                                )
                              }
                            >
                              {employee.active ? "Deactivate" : "Activate"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="button button-small button-danger"
                            disabled={busy}
                            onClick={() => setEmployeeToDelete(employee)}
                            aria-label={`Permanently delete ${employee.fullName}`}
                          >
                            <Trash2 size={13} />
                            Delete
                          </button>
                        </>
                      )}
                    </span>
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
          {employeeToApprove && (
            <ModalPortal>
              <div className="access-modal-backdrop">
                <section
                  className="access-modal employee-approval-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="employee-approval-title"
                >
                  <div className="access-modal-heading">
                    <div>
                      <h2 id="employee-approval-title">
                        Approve {employeeToApprove.fullName}
                      </h2>
                      <p>
                        {employeeToApprove.employeeCode} ·{" "}
                        {outlets.find(
                          (outlet) =>
                            outlet._id === employeeToApprove.outletId,
                        )?.code ?? "Outlet"} ·{" "}
                        {employeeToApprove.designation}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Close employee approval"
                      disabled={busy}
                      onClick={() => setEmployeeToApprove(null)}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <Notice error={error} success="" />
                  <p className="employee-approval-instructions">
                    Required documents are checked automatically. Review the
                    documents, then enter compensation to approve and activate.
                  </p>
                  <form
                    className="form-grid employee-approval-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void processEmployeeApproval(
                        "APPROVE",
                        new FormData(event.currentTarget),
                      );
                    }}
                  >
                    <label className="field">
                      <span>Monthly base salary (INR)</span>
                      <input
                        name="monthlyBaseSalary"
                        type="number"
                        min="0.01"
                        max="100000000"
                        step="0.01"
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Salary method</span>
                      <RoundedSelect name="salaryMethod" defaultValue="FIXED_30_DAYS">
                        <option value="FIXED_30_DAYS">Fixed 30 days</option>
                        <option value="CALENDAR_DAYS">Calendar days</option>
                        <option value="WORKING_DAYS_26">Working days (26)</option>
                      </RoundedSelect>
                    </label>
                    <label className="field">
                      <span>PF enabled</span>
                      <RoundedSelect name="pfEnabled" defaultValue="false">
                        <option value="false">No</option>
                        <option value="true">Yes</option>
                      </RoundedSelect>
                    </label>
                    <label className="field">
                      <span>Employee PF %</span>
                      <input
                        name="employeePfPercent"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        defaultValue="0"
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Employer PF %</span>
                      <input
                        name="employerPfPercent"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        defaultValue="0"
                        required
                      />
                    </label>
                    <label className="field">
                      <span>ESI enabled</span>
                      <RoundedSelect name="esiEnabled" defaultValue="false">
                        <option value="false">No</option>
                        <option value="true">Yes</option>
                      </RoundedSelect>
                    </label>
                    <label className="field">
                      <span>Employee ESI %</span>
                      <input
                        name="esiPercent"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        defaultValue="0.75"
                        required
                      />
                    </label>
                    <div className="form-actions employee-approval-actions">
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={busy}
                        onClick={() => {
                          const employee = employeeToApprove;
                          setEmployeeToApprove(null);
                          prefetchEmployeeDetail(
                            employee._id,
                            true,
                            user.email,
                          );
                          setEmployeeToEdit(employee);
                        }}
                      >
                        Review documents
                      </button>
                      <button
                        type="button"
                        className="button button-danger"
                        disabled={busy}
                        onClick={() =>
                          void processEmployeeApproval("REJECT")
                        }
                      >
                        Reject request
                      </button>
                      <button
                        type="submit"
                        className="button button-primary"
                        disabled={busy}
                      >
                        {busy ? "Processing…" : "Approve & activate"}
                      </button>
                    </div>
                  </form>
                </section>
              </div>
            </ModalPortal>
          )}
          {employeeToEdit && (
            <ModalPortal>
              <div
                className="access-modal-backdrop"
                onClick={(event) => {
                  if (event.target === event.currentTarget)
                    setEmployeeToEdit(null);
                }}
              >
                <section
                  className="access-modal employee-edit-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="employee-edit-title"
                >
                  <div className="access-modal-heading">
                    <div>
                      <h2 id="employee-edit-title">
                        Edit {employeeToEdit.fullName}
                      </h2>
                      <p>Update the employee record and save your changes.</p>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Close employee editor"
                      onClick={() => setEmployeeToEdit(null)}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <EmployeeDetail
                    key={employeeToEdit._id}
                    id={employeeToEdit._id}
                    cacheScope={user.email}
                    canEdit={user.permissions.includes("employees.update")}
                    mainAdmin={user.role === "MAIN_ADMIN"}
                    canViewSensitive={user.role !== "OUTLET_USER"}
                    canManageUniforms={user.permissions.includes("uniforms.manage")}
                    canManageShift={user.permissions.includes("employees.shift.manage")}
                    canManageFace={user.permissions.includes("employees.face.manage")}
                    modal
                    onSaved={(documentStorageWarning) => {
                      setEmployeeToEdit(null);
                      void reload();
                      if (documentStorageWarning)
                        setError(documentStorageWarning);
                      else setSuccess("Employee details saved.");
                    }}
                  />
                </section>
              </div>
            </ModalPortal>
          )}
          {employeeToDelete && (
            <ModalPortal>
              <div className="access-modal-backdrop">
                <section
                  className="access-modal employee-delete-modal"
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="employee-delete-title"
                  aria-describedby="employee-delete-description"
                >
                  <div className="access-modal-heading">
                    <div>
                      <h2 id="employee-delete-title">Delete employee</h2>
                      <p id="employee-delete-description">
                        Are you sure you want to permanently delete{" "}
                        {employeeToDelete.fullName}? This action cannot be
                        undone.
                      </p>
                      <p>
                        Attendance, payroll, advances, and loan history will be
                        preserved. Uploaded employee files will be deleted.
                      </p>
                    </div>
                  </div>
                  {error && <Notice error={error} success="" />}
                  <div className="employee-row-actions employee-delete-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() => setEmployeeToDelete(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="button button-danger"
                      disabled={busy}
                      onClick={() => void deleteEmployee()}
                    >
                      {busy ? "Deleting…" : "Delete permanently"}
                    </button>
                  </div>
                </section>
              </div>
            </ModalPortal>
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
              <RoundedSelect
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
              </RoundedSelect>
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
                  <RoundedSelect
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
                  </RoundedSelect>
                </label>
                <label className="field">
                  <span>Employee</span>
                  <RoundedSelect
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
                        ? `Select employee · ${(data.employees ?? []).filter(
                            (employee) => employee.outletId === advanceOutletId,
                          ).length} available`
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
                  </RoundedSelect>
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
                <Field
                  label="Given by"
                  name="givenBy"
                  defaultValue="Head office"
                  required
                />
                <Field
                  label="Reference / transaction"
                  name="reference"
                  required
                />
                <Field label="Reason" name="reason" required />
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
                <div className="toolbar" key="actions-header">
                  <span>Actions</span>
                  {user.permissions.includes("advances.approve") &&
                    (advanceStatus === "ALL" || advanceStatus === "PENDING") &&
                    (data.pendingCount ?? 0) > 0 && (
                      <button
                        type="button"
                        className="button button-small advance-approve-all-button"
                        disabled={busy}
                        onClick={() => {
                          setError("");
                          setIsApproveAllConfirmationOpen(true);
                        }}
                      >
                        <Check size={14} /> Approve All
                      </button>
                    )}
                </div>,
              ]}
              rows={(data.advances ?? []).map((item) => [
                formatDate(item.date),
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
                  {!item.payrollRecordId &&
                    user.permissions.includes("advances.write") && (
                      <button
                        type="button"
                        className="button button-small button-danger advance-delete-button"
                        disabled={busy}
                        onClick={() => {
                          setError("");
                          setAdvanceToDelete(item);
                        }}
                      >
                        <Trash2 size={14} /> Delete
                      </button>
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
              rowKeys={(data.advances ?? []).map((item) => item._id)}
              empty="No advances recorded for this period."
              page={page}
              pageSize={25}
              total={data.total ?? 0}
              onPageChange={setPage}
            />
          )}
          {advanceToDelete && (
            <ModalPortal>
              <div className="access-modal-backdrop">
                <section
                  className="access-modal employee-delete-modal"
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="advance-delete-title"
                  aria-describedby="advance-delete-description"
                >
                  <div className="access-modal-heading">
                    <div>
                      <h2 id="advance-delete-title">Delete advance?</h2>
                      <p id="advance-delete-description">
                        Are you sure you want to delete the{" "}
                        {currency(advanceToDelete.amount)} advance for{" "}
                        {advanceToDelete.employeeName ?? "this employee"} dated{" "}
                        {advanceToDelete.date}? This action cannot be undone.
                      </p>
                    </div>
                  </div>
                  {error && <Notice error={error} success="" />}
                  <div className="employee-row-actions employee-delete-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() => setAdvanceToDelete(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="button button-danger"
                      disabled={busy}
                      onClick={() => void deleteAdvance()}
                    >
                      <Trash2 size={14} /> {busy ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </section>
              </div>
            </ModalPortal>
          )}
          {isApproveAllConfirmationOpen && (
            <ModalPortal>
              <div className="access-modal-backdrop">
                <section
                  className="access-modal employee-delete-modal"
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="advance-approve-all-title"
                  aria-describedby="advance-approve-all-description"
                >
                  <div className="access-modal-heading">
                    <div>
                      <h2 id="advance-approve-all-title">
                        Approve all pending advances?
                      </h2>
                      <p id="advance-approve-all-description">
                        There are currently {data.pendingCount ?? 0} pending
                        advance(s) for{" "}
                        {selectedOutlet
                          ? data.outlets?.find(
                              (outlet) => outlet._id === selectedOutlet,
                            )?.name ?? "the selected outlet"
                          : "all accessible outlets"}
                        . Approve all eligible pending advances? Rejected and
                        payroll-assigned advances will not be changed.
                      </p>
                    </div>
                  </div>
                  {error && <Notice error={error} success="" />}
                  <div className="employee-row-actions employee-delete-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() =>
                        setIsApproveAllConfirmationOpen(false)
                      }
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={busy || !(data.pendingCount ?? 0)}
                      onClick={() => void approveAllAdvances()}
                    >
                      <Check size={14} />{" "}
                      {busy ? "Approving…" : "Approve All"}
                    </button>
                  </div>
                </section>
              </div>
            </ModalPortal>
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
                <RoundedSelect
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
                </RoundedSelect>
              </label>
              <label className="field">
                <span>Employee</span>
                <RoundedSelect
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
                </RoundedSelect>
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
                <RoundedSelect
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
                </RoundedSelect>
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
              <RoundedSelect
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
              </RoundedSelect>
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
                  <RoundedSelect
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
                  </RoundedSelect>
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
                    <RoundedSelect
                      name="repaymentMethod"
                      defaultValue={loanToEdit.repaymentMethod ?? "FIXED_AMOUNT"}
                    >
                      <option value="FIXED_AMOUNT">Fixed monthly deduction</option>
                      <option value="FIXED_INSTALLMENTS">Fixed number of installments</option>
                      <option value="DATE_RANGE">Start and end month</option>
                    </RoundedSelect>
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
      const normalizedSalarySearch = salarySearch.trim().toLowerCase();
      const matchesSalarySearch = (...values: Array<string | null | undefined>) =>
        !normalizedSalarySearch ||
        values.some((value) =>
          value?.toLowerCase().includes(normalizedSalarySearch),
        );
      const salaryRecords = (data.records ?? []).filter((record) =>
        matchesSalarySearch(
          record.inputSnapshot.employee.fullName,
          record.inputSnapshot.employee.employeeCode,
        ),
      );
      const ungeneratedPayrollEmployees = payrollEmployees.filter(
        (employee) =>
          !employee.payrollRecordId &&
          matchesSalarySearch(
            employee.fullName,
            employee.employeeCode,
            employee.designation,
            employee.outletCode,
            employee.mobile,
          ),
      );
      const salaryTotal =
        salaryRecords.length + ungeneratedPayrollEmployees.length;
      const salaryPageCount =
        salaryPageSize === "all"
          ? 1
          : Math.max(1, Math.ceil(salaryTotal / salaryPageSize));
      const currentSalaryPage = Math.min(salaryPage, salaryPageCount);
      return (
        <div className="content-area">
          <PageHead
            title="Monthly salary"
            description="Generate, review, adjust, approve and record payroll payments."
            action={
              <div className="toolbar">
                <label className="search-field">
                  <Search size={16} />
                  <input
                    value={salarySearch}
                    onChange={(event) => {
                      setSalaryPage(1);
                      setSalarySearch(event.target.value);
                    }}
                    placeholder="Search employees"
                    aria-label="Search monthly salary"
                  />
                </label>
                <input
                  type="month"
                  value={month}
                  onChange={(event) => {
                    setSalaryGenerateEmployee(null);
                    setSalaryPage(1);
                    setMonth(event.target.value);
                  }}
                  aria-label="Payroll month"
                />
                {toolbar}
                {user.permissions.includes("reports.export") &&
                  user.permissions.includes("salary.read") && (
                  <div className="salary-export-actions" aria-label="Export salary">
                    {(["xlsx", "csv"] as const).map((format) => (
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
                    ))}
                  </div>
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
              className="salary-table"
              headers={[
                "Employee",
                "Monthly salary",
                "Period",
                "Days P / A / HD / WO",
                "Days filled",
                "Not marked",
                "Allowed week off",
                "Total equivalent days",
                "Chargeable days",
                "Attendance deduction",
                "Not marked deduction",
                "Used / allowed (days)",
                "Gross",
                "Advances",
                "Uniform deduction",
                "ESI (deduction)",
                "PF (tracked)",
                "PF (deduction)",
                "Original loan",
                "Remaining loan",
                "Scheduled deduction",
                "Actual deduction",
                "Net payable",
                "Status",
                "Actions",
              ]}
              rows={[
                ...salaryRecords.map((record: SalaryView) => {
                const loanSnapshot = record.inputSnapshot.loans ?? [];
                const uniformSnapshot = record.inputSnapshot.uniformDeductions ?? [];
                const loanTotal = (key: "originalAmount" | "closingBalance" | "scheduledDeduction" | "actualDeduction") =>
                  loanSnapshot.reduce((sum, loan) => sum + loan[key], 0);
                return [
                <div key="employee">
                  <strong>{record.inputSnapshot.employee.fullName}</strong>
                  <span className="sub-cell">
                    {record.inputSnapshot.employee.employeeCode}
                  </span>
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
                      <dt>Not marked days</dt>
                      <dd>{record.calculation.notMarkedDays ?? 0}</dd>
                      <dt>Allowed week-off allowance</dt>
                      <dd>{record.calculation.allowedWeekOff ?? 3}</dd>
                      <dt>Total equivalent days</dt>
                      <dd>{record.calculation.totalEquivalentDays ?? 0}</dd>
                      <dt>Chargeable days</dt>
                      <dd>{record.calculation.chargeableDays ?? 0}</dd>
                      <dt>Attendance deduction</dt>
                      <dd>{currency(record.calculation.attendanceDeduction ?? 0)}</dd>
                      <dt>Not marked deduction</dt>
                      <dd>{currency(record.calculation.notMarkedDeduction ?? 0)}</dd>
                      <dt>Used / allowed (days)</dt>
                      <dd>
                        {record.calculation.allowanceConsumed ?? 0} of{" "}
                        {record.calculation.allowedWeekOff ?? 3}
                      </dd>
                      <dt>Overtime / allowances</dt>
                      <dd>
                        {currency(record.calculation.overtime)} /{" "}
                        {currency(record.calculation.allowances)}
                      </dd>
                      <dt>Other deductions</dt>
                      <dd>{currency(record.calculation.otherDeductions)}</dd>
                      <dt>Uniform deductions</dt>
                      <dd>
                        {currency(record.calculation.uniformDeductions ?? 0)}
                        {uniformSnapshot.map((deduction, index) => (
                          <span className="sub-cell" key={`${deduction.item}-${index}`}>
                            {UNIFORM_ITEM_LABELS[deduction.item]} · {currency(deduction.amount)}
                          </span>
                        ))}
                      </dd>
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
                record.inputSnapshot.employee.monthlyBaseSalary !== undefined
                  ? currency(record.inputSnapshot.employee.monthlyBaseSalary)
                  : "-",
                record.periodStart && record.periodEnd
                  ? `${formatDate(record.periodStart)} – ${formatDate(record.periodEnd)}`
                  : "Full month (legacy)",
                `${record.calculation.presentDays} / ${record.calculation.absentDays} / ${record.calculation.halfDays} / ${record.calculation.weekOffs}`,
                record.calculation.presentDays +
                  record.calculation.absentDays +
                  record.calculation.halfDays +
                  record.calculation.weekOffs,
                record.calculation.notMarkedDays ?? 0,
                record.calculation.allowedWeekOff ?? 3,
                record.calculation.totalEquivalentDays ?? 0,
                record.calculation.chargeableDays ?? 0,
                currency(record.calculation.attendanceDeduction ?? 0),
                currency(record.calculation.notMarkedDeduction ?? 0),
                `${record.calculation.allowanceConsumed ?? 0} of ${record.calculation.allowedWeekOff ?? 3}`,
                currency(record.calculation.grossEarnings),
                currency(record.calculation.advances),
                currency(record.calculation.uniformDeductions ?? 0),
                currency(record.calculation.esi ?? 0),
                currency(record.calculation.employerPf ?? 0),
                currency(record.calculation.employeePf),
                loanSnapshot.length ? currency(loanTotal("originalAmount")) : "-",
                loanSnapshot.length ? currency(loanTotal("closingBalance")) : "-",
                loanSnapshot.length ? currency(loanTotal("scheduledDeduction")) : "-",
                loanSnapshot.length ? currency(loanTotal("actualDeduction")) : "-",
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
                ...ungeneratedPayrollEmployees.map((employee) => [
                  <div key={employee._id}>
                    <strong>{employee.fullName}</strong>
                    <span className="sub-cell">
                      {employee.employeeCode} · {employee.designation} ·{" "}
                      {employee.outletCode}
                    </span>
                    <span className="sub-cell">{employee.mobile || "-"}</span>
                    {employee.suggestedPeriodEnd && (
                      <span className="sub-cell">
                        Ready through {employee.suggestedPeriodEnd}
                      </span>
                    )}
                  </div>,
                  currency(employee.monthlyBaseSalary),
                  "-",
                  `${employee.attendance.P} / ${employee.attendance.A} / ${employee.attendance.HD} / ${employee.attendance.WO}`,
                  employee.attendance.P +
                    employee.attendance.A +
                    employee.attendance.HD +
                    employee.attendance.WO,
                  employee.liveNotMarkedDays ??
                    employee.estimatedCalculation?.notMarkedDays ??
                    "-",
                  employee.estimatedCalculation?.allowedWeekOff ?? 3,
                  employee.estimatedCalculation?.totalEquivalentDays ?? "-",
                  employee.estimatedCalculation?.chargeableDays ?? "-",
                  employee.estimatedCalculation
                    ? currency(employee.estimatedCalculation.attendanceDeduction)
                    : "-",
                  employee.estimatedCalculation
                    ? currency(employee.estimatedCalculation.notMarkedDeduction)
                    : "-",
                  employee.estimatedCalculation
                    ? `${employee.estimatedCalculation.allowanceConsumed} of ${employee.estimatedCalculation.allowedWeekOff}`
                    : "-",
                  employee.estimatedCalculation
                    ? currency(employee.estimatedCalculation.grossEarnings)
                    : "-",
                  currency(
                    employee.estimatedCalculation?.advances ??
                      employee.approvedAdvanceTotal,
                  ),
                  currency(
                    employee.estimatedCalculation?.uniformDeductions ??
                      employee.estimatedUniformDeduction ??
                      0,
                  ),
                  employee.estimatedCalculation
                    ? currency(employee.estimatedCalculation.esi)
                    : "-",
                  employee.estimatedCalculation
                    ? currency(employee.estimatedCalculation.employerPf)
                    : "-",
                  employee.estimatedCalculation
                    ? currency(employee.estimatedCalculation.employeePf)
                    : "-",
                  "-",
                  employee.outstandingLoanTotal > 0
                    ? currency(employee.outstandingLoanTotal)
                    : "-",
                  employee.estimatedCalculation
                    ? currency(employee.estimatedCalculation.loanDeduction)
                    : "-",
                  "-",
                  currency(
                    employee.estimatedCalculation?.netPayable ??
                      employee.estimatedNetPayable ??
                      0,
                  ),
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
              page={currentSalaryPage}
              pageSize={salaryPageSize}
              pageSizeOptions={[20, 25, 50, 100]}
              total={salaryTotal}
              onPageChange={setSalaryPage}
              onPageSizeChange={(nextPageSize) => {
                setSalaryPageSize(nextPageSize);
                setSalaryPage(1);
              }}
              paginateRows
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
                  <RoundedSelect name="active" defaultValue="true">
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </RoundedSelect>
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
            <div className="ol-list">
              <OutletListManager
                outlets={data.outlets ?? []}
                canManage={user.role === "MAIN_ADMIN"}
                busy={busy}
                onSave={(outlet, fields, confirmEmployeeCodeUpdateCount) =>
                  mutate(
                    `/api/outlets/${encodeURIComponent(outlet._id)}`,
                    { ...fields, confirmEmployeeCodeUpdateCount },
                    "PATCH",
                    `${outlet.code} updated.`,
                  )
                }
                onWeekOffChange={(outlet, weekly_off_count) =>
                  mutate(
                    `/api/outlets/${encodeURIComponent(outlet._id)}`,
                    { weekly_off_count },
                    "PATCH",
                    `${outlet.name}: week off ${weekly_off_count} par set ho gaya`,
                  )
                }
                onOrderAction={(body, successMessage) =>
                  mutate("/api/outlets/order", body, "PATCH", successMessage)
                }
              />
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
                <RoundedSelect
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
                </RoundedSelect>
              </label>
              {newAccountProfile !== "MAIN_ADMIN" && (
                <label className="field">
                  <span>Assigned outlet · choose one</span>
                  <RoundedSelect name="outletIds" required>
                    <option value="">Select outlet</option>
                    {activeOutlets.map((outlet) => (
                      <option key={outlet._id} value={outlet._id}>
                        {outlet.code} · {outlet.name}
                      </option>
                    ))}
                    <option value="__ALL_OUTLETS__">All outlets</option>
                  </RoundedSelect>
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
                  <UserDeleteControl
                    item={item}
                    disabled={
                      item.email.toLowerCase() === user.email.toLowerCase()
                    }
                    onDelete={async () => {
                      await request(`/api/users/${item._id}`, {
                        method: "DELETE",
                      });
                      await reload();
                      setSuccess("User deleted.");
                    }}
                  />
                </div>,
              ])}
              empty="No provisioned users."
            />
          )}
        </div>
      );

    if (section === "reports")
      return <ReportsPanel outlets={activeOutlets} enabled={outletsLoaded} />;
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

    async function submitEdit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const saved = await onSave({
        employeeId: item.employeeId,
        outletId: item.outletId,
        date: values.get("date"),
        amount: Number(values.get("amount")),
        givenBy: values.get("givenBy"),
        reference: values.get("reference"),
        reason: values.get("reason"),
      });
      if (saved) setIsOpen(false);
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
                  <span>Reason</span>
                  <input
                    name="reason"
                    defaultValue={item.reason ?? item.notes ?? ""}
                    minLength={2}
                    maxLength={1000}
                    required
                  />
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
        <Link
          className="button button-small"
          href={`/salary/slips/${record._id}`}
          target="_blank"
          rel="noreferrer"
        >
          Payslip
        </Link>
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
    const netPayable = calculateNetPayable({
      ...record.calculation,
      ...amounts,
    });

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
                    <RoundedSelect
                      value={adjustmentKind}
                      onChange={(event) => setAdjustmentKind(event.target.value)}
                    >
                      <option value="OVERTIME">Overtime</option>
                      <option value="ALLOWANCE">Allowance</option>
                      <option value="DEDUCTION">Deduction</option>
                    </RoundedSelect>
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
      uniformDeductions: number;
      esi: number;
      employeePf: number;
      employerPf: number;
      loanDeduction: number;
      attendanceDeduction?: number;
      notMarkedDeduction?: number;
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
      uniformDeductions: Array<{
        _id: string;
        item: UniformItemKey;
        amount: number;
        deductionMonth: string;
        remark: string;
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
      const controller = new AbortController();
      const params = new URLSearchParams({
        month,
        outletId: employee.outletId,
        employeeId: employee._id,
        periodStart,
        periodEnd,
      });
      void request<Preview>(`/api/payroll/preview?${params.toString()}`, {
        signal: controller.signal,
      })
        .then((result) => {
          if (!current) return;
          setPreview(result);
          setAmounts(result.amounts);
          setAdvanceIds(result.advances.map((advance) => advance._id));
        })
        .catch((caught) => {
          if (!current || controller.signal.aborted) return;
          setPreviewError(
            caught instanceof Error ? caught.message : "Unable to prepare payroll preview.",
          );
        });
      return () => {
        current = false;
        controller.abort();
      };
    }, [employee._id, employee.outletId, month, periodEnd, periodStart]);

    const netPayable = amounts
      ? calculateNetPayable(amounts)
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
                  <AmountField
                    label="Uniform deduction (INR)"
                    value={amounts?.uniformDeductions ?? 0}
                    disabled
                    onChange={() => {}}
                    help={preview.uniformDeductions.length
                      ? preview.uniformDeductions
                          .map((item) => `${UNIFORM_ITEM_LABELS[item.item]}: ${currency(item.amount)}`)
                          .join(" · ")
                      : "No uniform deductions scheduled for this month."}
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
                    <label className="salary-approve-option">
                      <input
                        type="checkbox"
                        checked={approveNow}
                        onChange={(event) =>
                          setApproveNow(event.target.checked)
                        }
                      />
                      <span>
                        Check to approve this payroll immediately. Leave unchecked to save it as a draft.
                      </span>
                    </label>
                  )}
                  <button
                    className={`button ${
                      approveNow
                        ? "button-primary"
                        : "button-secondary salary-generate-draft"
                    }`}
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
    if (period === "YESTERDAY") {
      start.setUTCDate(start.getUTCDate() - 1);
      end.setUTCDate(end.getUTCDate() - 1);
    }
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
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const filteredEmployees = employees.filter((employee) => {
      if (filter === "ALL") return true;
      if (filter === "UNMARKED") return employee.status === null;
      return employee.status === filter;
    });
    const pageCount = Math.max(1, Math.ceil(filteredEmployees.length / pageSize));
    const currentPage = Math.min(page, pageCount);
    const visibleEmployees = filteredEmployees.slice(
      (currentPage - 1) * pageSize,
      currentPage * pageSize,
    );

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
                onClick={() => {
                  setPage(1);
                  onFilterChange(value);
                }}
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
              {visibleEmployees.map((employee) => (
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
        {filteredEmployees.length > 0 && (
          <TablePagination
            page={currentPage}
            pageSize={pageSize}
            total={filteredEmployees.length}
            onPageChange={setPage}
            onPageSizeChange={(nextPageSize) => {
              setPageSize(nextPageSize);
              setPage(1);
            }}
          />
        )}
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
    accrualDate,
    metrics,
    selectedOutlet,
    onSelectOutlet,
    canReadEmployees,
    canReadSalary,
  }: {
    days: NonNullable<WorkspaceData["attendanceTrend"]>;
    from: string;
    to: string;
    accrualDate: string;
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
              accrualDate={accrualDate}
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
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState<number | "all">(10);
    const pageCount =
      pageSize === "all"
        ? 1
        : Math.max(1, Math.ceil(employees.length / pageSize));
    const currentPage = Math.min(page, pageCount);
    const visibleEmployees =
      pageSize === "all"
        ? employees
        : employees.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    const firstItem = employees.length
      ? (currentPage - 1) *
          (pageSize === "all" ? employees.length : pageSize) +
        1
      : 0;
    const lastItem =
      pageSize === "all"
        ? employees.length
        : Math.min(currentPage * pageSize, employees.length);

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
              <RoundedSelect
                aria-label="Attendance date range"
                value={period}
                onChange={(event) => {
                  setPage(1);
                  onPeriodChange(event.target.value);
                }}
              >
                <option value="TODAY">Today</option>
                <option value="YESTERDAY">Yesterday</option>
                <option value="THIS_MONTH">This month</option>
                <option value="LAST_WEEK">Last 7 days</option>
                <option value="LAST_MONTH">Last month</option>
                <option value="ALL_TIME">All time</option>
                <option value="CUSTOM">Custom range</option>
              </RoundedSelect>
            </label>
            {period === "CUSTOM" && (
              <>
                <input
                  aria-label="Attendance start date"
                  type="date"
                  value={customFrom}
                  onChange={(event) => {
                    setPage(1);
                    onCustomFromChange(event.target.value);
                  }}
                />
                <input
                  aria-label="Attendance end date"
                  type="date"
                  value={customTo}
                  onChange={(event) => {
                    setPage(1);
                    onCustomToChange(event.target.value);
                  }}
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
              {visibleEmployees.map((employee) => (
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
        {employees.length > 0 && (
          <div className="panel-footer dashboard-table-pagination">
            <span>
              Showing {firstItem}–{lastItem} of {employees.length} employees
            </span>
            <div className="pagination table-pagination-controls">
              <label className="table-page-size">
                Rows per page
                <RoundedSelect
                  aria-label="Who’s Away rows per page"
                  value={pageSize}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPageSize(value === "all" ? "all" : Number(value));
                    setPage(1);
                  }}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value="all">All</option>
                </RoundedSelect>
              </label>
              <button
                className="icon-button"
                aria-label="Previous page"
                title="Previous page"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft size={17} />
              </button>
              <span>
                {currentPage} / {pageCount}
              </span>
              <button
                className="icon-button"
                aria-label="Next page"
                title="Next page"
                disabled={currentPage >= pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
        )}
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
            <svg className="dashboard-attendance-trend" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Daily attendance rate trend">
              <defs>
                <linearGradient id="dashboard-attendance-area" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--present)" stopOpacity=".22" />
                  <stop offset="100%" stopColor="var(--present)" stopOpacity="0" />
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
            const tooltip =
              rate === null
                ? `${formatDate(day.date)} · ${WO ? "Week off / no attendance marks" : "No attendance data"}`
                : `${formatDate(day.date)} · ${rate.toFixed(1)}% attendance · P ${P}, A ${A}, HD ${HD}, WO ${WO}`;
            return (
              <span
                key={day.date}
                className={`dashboard-heatmap-day heatmap-${tone}`}
                title={tooltip}
                aria-label={tooltip}
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
    accrualDate,
  }: {
    metrics?: WorkspaceData["metrics"];
    employeeCount: number;
    accrualDate: string;
  }) {
    const net = metrics?.netPayable ?? 0;
    const hasGeneratedPayroll = (metrics?.payrollCount ?? 0) > 0;
    const loanDeductions = hasGeneratedPayroll
      ? (metrics?.recordedLoanDeductions ?? 0)
      : (metrics?.liveLoanDeductions ?? 0);
    const periodStart = `${accrualDate.slice(0, 7)}-01`;
    return (
      <section className="panel dashboard-payroll-panel">
        <div className="panel-heading">
          <div>
            <h2>Payroll breakdown</h2>
            <p>Live accrual period · {formatDate(periodStart)} – {formatDate(accrualDate)}</p>
          </div>
          <Link className="dashboard-panel-link" href="/salary">Review payroll <ArrowUpRight size={14} /></Link>
        </div>
        <div className="dashboard-payroll-content">
          {metrics?.netPayable == null ? (
            <Empty>Salary permission is required to view payroll totals.</Empty>
          ) : (
            <>
              <div className="dashboard-payroll-values">
                <div><span>Approved advances</span><strong className="payroll-value-highlight">{metrics.approvedAdvancesPendingPayroll == null ? "—" : currency(metrics.approvedAdvancesPendingPayroll)}</strong><small>Approved this month</small></div>
                <div><span>{hasGeneratedPayroll ? "Loan deductions in generated payroll" : "Scheduled loan deductions this month"}</span><strong className="payroll-value-highlight">{currency(loanDeductions)}</strong></div>
                <div><span>Net payroll · all employees</span><strong className="payroll-value-net payroll-value-highlight">{currency(net)}</strong><small>After attendance and deductions through {formatDate(accrualDate)}</small></div>
                <div><span>Average net / active employee</span><strong className="payroll-value-highlight">{employeeCount ? currency(net / employeeCount) : currency(0)}</strong><small>Current month-to-date amount</small></div>
              </div>
              <p className="dashboard-payroll-note">
                Net payroll uses submitted attendance and current payroll rules, including approved advances and configured deductions. Loan deductions show generated payroll totals when available, otherwise this month’s scheduled installments.
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

  function DataTable({
    className,
    headers,
    rows,
    rowClassNames,
    empty,
    page = 1,
    pageSize = 25,
    pageSizeOptions,
    total,
    onPageChange,
    onPageSizeChange,
    paginateRows = false,
    rowKeys,
  }: {
    className?: string;
    headers: React.ReactNode[];
    rows: React.ReactNode[][];
    rowKeys?: Array<string | number>;
    rowClassNames?: string[];
    empty: string;
    page?: number;
    pageSize?: number | "all";
    pageSizeOptions?: readonly number[];
    total?: number;
    onPageChange?: (page: number) => void;
    onPageSizeChange?: (pageSize: number | "all") => void;
    paginateRows?: boolean;
  }) {
    if (process.env.NODE_ENV !== "production") {
      rows.forEach((row, index) => {
        if (row.length !== headers.length) {
          console.warn(
            `DataTable row ${index} has ${row.length} cells, expected ${headers.length}.`,
          );
        }
      });
    }

    const pageCount =
      total === undefined || pageSize === "all"
        ? 1
        : Math.max(1, Math.ceil(total / pageSize));
    const visibleRows =
      paginateRows && pageSize !== "all"
        ? rows.slice((page - 1) * pageSize, page * pageSize)
        : rows;
    return (
      <section className={`panel ${className ?? ""}`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {headers.map((header, index) => (
                  <th key={index}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => (
                <tr
                  key={rowKeys?.[index] ?? index}
                  className={rowClassNames?.[index]}
                >
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {visibleRows.length === 0 && <Empty>{empty}</Empty>}
        </div>
        <div className="panel-footer">
          <span>
            {total ?? rows.length} records · page {page} of {pageCount}
          </span>
          <div className="pagination">
            {onPageSizeChange && (
              <label className="table-page-size">
                Rows per page
                <RoundedSelect
                  aria-label="Rows per page"
                  value={pageSize}
                  onChange={(event) =>
                    onPageSizeChange(
                      event.target.value === "all"
                        ? "all"
                        : Number(event.target.value),
                    )
                  }
                >
                  {pageSizeOptions?.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                  <option value="all">All</option>
                </RoundedSelect>
              </label>
            )}
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

  const TABLE_PAGE_SIZES = [10, 50, 100] as const;

  function TablePagination({
    page,
    pageSize,
    total,
    onPageChange,
    onPageSizeChange,
  }: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
  }) {
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const firstItem = (page - 1) * pageSize + 1;
    const lastItem = Math.min(page * pageSize, total);

    return (
      <div className="panel-footer dashboard-table-pagination">
        <span>
          Showing {firstItem}–{lastItem} of {total} employees
        </span>
        <div className="pagination table-pagination-controls">
          <label className="table-page-size">
            Rows per page
            <RoundedSelect
              aria-label="Rows per page"
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              {TABLE_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </RoundedSelect>
          </label>
          <button
            className="icon-button"
            aria-label="Previous page"
            title="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft size={17} />
          </button>
          <span>
            {page} / {pageCount}
          </span>
          <button
            className="icon-button"
            aria-label="Next page"
            title="Next page"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
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
                  <RoundedSelect
                    name="closureType"
                    value={closureType}
                    onChange={(event) => setClosureType(event.target.value)}
                  >
                    <option value="EXTERNAL_SETTLEMENT">
                      Fully or partially settled outside payroll
                    </option>
                    <option value="WRITE_OFF">Waived / written off</option>
                    <option value="OTHER">Other approved closure</option>
                  </RoundedSelect>
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
                  <RoundedSelect name="direction" defaultValue="REDUCE">
                    <option value="REDUCE">Reduce balance</option>
                    <option value="INCREASE">
                      Increase (additional disbursement)
                    </option>
                  </RoundedSelect>
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

  type OutletEditableFields = Pick<
    Outlet,
    | "name"
    | "active"
    | "address"
    | "city"
    | "managerName"
    | "contactPhone"
  >;
  type OutletOrderAction =
    | { action: "SAVE_DRAFT"; outletIds: string[] }
    | { action: "PUBLISH" }
    | { action: "DISCARD" };

  function sameOutletOrder(left: readonly string[], right: readonly string[]) {
    return (
      left.length === right.length &&
      left.every((outletId, index) => outletId === right[index])
    );
  }

  function OutletListManager({
    outlets,
    canManage,
    busy,
    onSave,
    onWeekOffChange,
    onOrderAction,
  }: {
    outlets: Outlet[];
    canManage: boolean;
    busy: boolean;
    onSave: (
      outlet: Outlet,
      fields: OutletEditableFields,
      confirmEmployeeCodeUpdateCount: number,
    ) => Promise<boolean>;
    onWeekOffChange: (outlet: Outlet, count: number) => Promise<boolean>;
    onOrderAction: (
      body: OutletOrderAction,
      successMessage: string,
    ) => Promise<boolean>;
  }) {
    const uniqueOutlets = Array.from(
      new Map(outlets.map((outlet) => [outlet._id, outlet])).values(),
    );
    const liveOrder = uniqueOutlets.map((outlet) => outlet._id);
    const hasSavedDraft = uniqueOutlets.some(
      (outlet) => typeof outlet.draft_sort_order === "number",
    );
    const savedDraftOrder = hasSavedDraft
      ? [
          ...uniqueOutlets.filter(
            (outlet) => typeof outlet.draft_sort_order === "number",
          ),
        ]
          .sort(
            (left, right) =>
              (left.draft_sort_order ?? Number.MAX_SAFE_INTEGER) -
              (right.draft_sort_order ?? Number.MAX_SAFE_INTEGER),
          )
          .map((outlet) => outlet._id)
      : liveOrder;
    const completeSavedDraft = [
      ...savedDraftOrder,
      ...liveOrder.filter((outletId) => !savedDraftOrder.includes(outletId)),
    ];
    const [localOrder, setLocalOrder] = useState<string[] | null>(null);
    const [activeOrderAction, setActiveOrderAction] = useState<
      OutletOrderAction["action"] | null
    >(null);
    const baseOrder = completeSavedDraft;
    const candidateOrder = localOrder ?? baseOrder;
    const uniqueCandidateOrder = [...new Set(candidateOrder)];
    const displayedOrder = [
      ...uniqueCandidateOrder.filter((outletId) =>
        liveOrder.includes(outletId),
      ),
      ...liveOrder.filter(
        (outletId) => !uniqueCandidateOrder.includes(outletId),
      ),
    ];
    const unsavedChanges =
      localOrder !== null && !sameOutletOrder(displayedOrder, baseOrder);
    const outletsById = new Map(
      uniqueOutlets.map((outlet) => [outlet._id, outlet] as const),
    );
    const orderedOutlets = displayedOrder
      .map((outletId) => outletsById.get(outletId))
      .filter((outlet): outlet is Outlet => outlet !== undefined);

    useEffect(() => {
      if (!unsavedChanges) return;
      function warnBeforeLeaving(event: BeforeUnloadEvent) {
        event.preventDefault();
        event.returnValue = "";
      }
      window.addEventListener("beforeunload", warnBeforeLeaving);
      return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
    }, [unsavedChanges]);

    function move(index: number, direction: -1 | 1) {
      const next = moveOutletOrder(displayedOrder, index, direction);
      setLocalOrder(
        sameOutletOrder(next, baseOrder) ? null : next,
      );
    }

    async function runOrderAction(
      body: OutletOrderAction,
      successMessage: string,
    ) {
      setActiveOrderAction(body.action);
      try {
        return await onOrderAction(body, successMessage);
      } finally {
        setActiveOrderAction(null);
      }
    }

    async function saveDraft() {
      if (
        await runOrderAction(
          { action: "SAVE_DRAFT", outletIds: displayedOrder },
          "Outlet order draft saved.",
        )
      )
        setLocalOrder(null);
    }

    async function discardDraft() {
      if (
        !window.confirm("Discard the saved outlet order draft?")
      )
        return;
      if (
        await runOrderAction(
          { action: "DISCARD" },
          "Outlet order draft discarded.",
        )
      )
        setLocalOrder(null);
    }

    return (
      <>
        {canManage && hasSavedDraft && (
          <div className="outlet-order-bar outlet-order-bar-top">
            <strong>Draft ready</strong>
            <div className="outlet-order-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={busy}
                onClick={() => void discardDraft()}
              >
                {activeOrderAction === "DISCARD"
                  ? "Discarding..."
                  : "Discard draft"}
              </button>
              <button
                className="button button-primary"
                type="button"
                disabled={busy}
                onClick={() =>
                  void runOrderAction(
                    { action: "PUBLISH" },
                    "Outlet order published.",
                  )
                }
              >
                {activeOrderAction === "PUBLISH" ? "Publishing..." : "Publish"}
              </button>
            </div>
          </div>
        )}
        {orderedOutlets.map((outlet, index) => (
          <OutletCard
            key={outlet._id}
            outlet={outlet}
            canManage={canManage}
            busy={busy}
            orderIndex={index}
            orderCount={orderedOutlets.length}
            onMove={(direction) => move(index, direction)}
            onSave={(fields, confirmEmployeeCodeUpdateCount) =>
              onSave(outlet, fields, confirmEmployeeCodeUpdateCount)
            }
            onWeekOffChange={(count) => onWeekOffChange(outlet, count)}
          />
        ))}
        {canManage && unsavedChanges && (
          <div className="outlet-order-bar outlet-order-bar-bottom">
            <strong>Unsaved changes</strong>
            <div className="outlet-order-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={busy}
                onClick={() => setLocalOrder(null)}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                type="button"
                disabled={busy}
                onClick={() => void saveDraft()}
              >
                {activeOrderAction === "SAVE_DRAFT" ? "Saving..." : "Save draft"}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  function OutletCard({
    outlet,
    canManage,
    busy,
    orderIndex,
    orderCount,
    onMove,
    onSave,
    onWeekOffChange,
  }: {
    outlet: Outlet;
    canManage: boolean;
    busy: boolean;
    orderIndex: number;
    orderCount: number;
    onMove: (direction: -1 | 1) => void;
    onSave: (
      fields: OutletEditableFields,
      confirmEmployeeCodeUpdateCount: number,
    ) => Promise<boolean>;
    onWeekOffChange: (count: number) => Promise<boolean>;
  }) {
    const [expanded, setExpanded] = useState(false);
    const [name, setName] = useState(outlet.name ?? outlet.code);
    const [active, setActive] = useState(outlet.active ?? false);
    const [address, setAddress] = useState(outlet.address ?? "");
    const [city, setCity] = useState(outlet.city ?? "");
    const [managerName, setManagerName] = useState(outlet.managerName ?? "");
    const [contactPhone, setContactPhone] = useState(outlet.contactPhone ?? "");
    const [weeklyOffCount, setWeeklyOffCount] = useState(
      outlet.weekly_off_count ?? 3,
    );
    const [savingWeekOff, setSavingWeekOff] = useState(false);
    const [savingOutlet, setSavingOutlet] = useState(false);
    const weekOffTimer = useRef<number | null>(null);
    const persistedWeekOff = useRef(outlet.weekly_off_count ?? 3);
    const latestWeekOff = useRef(outlet.weekly_off_count ?? 3);
    useEffect(() => {
      const persisted = outlet.weekly_off_count ?? 3;
      persistedWeekOff.current = persisted;
      if (!savingWeekOff && weekOffTimer.current === null) {
        latestWeekOff.current = persisted;
        setWeeklyOffCount(persisted);
      }
    }, [outlet.weekly_off_count, savingWeekOff]);
    useEffect(
      () => () => {
        if (weekOffTimer.current !== null)
          window.clearTimeout(weekOffTimer.current);
      },
      [],
    );

    function scheduleWeekOffSave(value: number) {
      latestWeekOff.current = value;
      setWeeklyOffCount(value);
      if (weekOffTimer.current !== null)
        window.clearTimeout(weekOffTimer.current);
      weekOffTimer.current = window.setTimeout(async () => {
        weekOffTimer.current = null;
        setSavingWeekOff(true);
        const saved = await onWeekOffChange(value);
        if (saved) {
          persistedWeekOff.current = value;
        } else if (latestWeekOff.current === value) {
          latestWeekOff.current = persistedWeekOff.current;
          setWeeklyOffCount(persistedWeekOff.current);
        }
        setSavingWeekOff(false);
      }, 350);
    }

    async function saveOutlet(
      fields: OutletEditableFields,
      confirmEmployeeCodeUpdateCount: number,
    ) {
      setSavingOutlet(true);
      try {
        await onSave(fields, confirmEmployeeCodeUpdateCount);
      } finally {
        setSavingOutlet(false);
      }
    }

    const normalizedName = name.trim();
    const changed =
      normalizedName !== (outlet.name ?? outlet.code) ||
      active !== (outlet.active ?? false) ||
      address !== (outlet.address ?? "") ||
      city !== (outlet.city ?? "") ||
      managerName !== (outlet.managerName ?? "") ||
      contactPhone !== (outlet.contactPhone ?? "");
    const editable = canManage && !busy;
    const panelId = `outlet-details-${outlet._id}`;
    return (
      <article className="ol-card" data-open={expanded}>
        <div
          className="ol-row"
          onClick={() => setExpanded((current) => !current)}
        >
          {canManage && (
            <div
              className="ol-arrows"
              aria-label="Reorder outlet"
            >
              <button
                className="ol-arrow"
                type="button"
                aria-label="Move outlet up"
                title="Move outlet up"
                disabled={!editable || orderIndex === 0}
                onClick={(event) => {
                  event.stopPropagation();
                  onMove(-1);
                }}
              >
                <ChevronUp size={14} />
              </button>
              <button
                className="ol-arrow"
                type="button"
                aria-label="Move outlet down"
                title="Move outlet down"
                disabled={!editable || orderIndex === orderCount - 1}
                onClick={(event) => {
                  event.stopPropagation();
                  onMove(1);
                }}
              >
                <ChevronDown size={14} />
              </button>
            </div>
          )}
          <button
            className="ol-chevron"
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${name || outlet.code}`}
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((current) => !current);
            }}
          >
            <ChevronRight size={17} />
          </button>
          <span className="ol-icon" aria-hidden="true">
            <Building2 size={17} />
          </span>
          <div className="ol-title">
            <strong>{name || outlet.code}</strong>
            <span className="ol-code">{outlet.code}</span>
          </div>
          <div className="ol-badges">
            {changed && <span className="ol-badge ol-badge--unsaved">Unsaved</span>}
            <span className={`ol-badge ${active ? "ol-badge--active" : "ol-badge--inactive"}`}>
              {active ? "Active" : "Inactive"}
            </span>
          </div>
        </div>
        <div
          className="ol-panel"
          id={panelId}
          aria-hidden={!expanded}
          inert={!expanded}
        >
          <div className="ol-panel-inner">
            <div className="ol-panel-body">
              <div className="ol-grid">
                <label className="ol-field">
                  <span>Outlet name</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    disabled={!editable}
                  />
                </label>
                <label className="ol-field">
                  <span>Address</span>
                  <input
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    disabled={!editable}
                  />
                </label>
                <label className="ol-field">
                  <span>City</span>
                  <input
                    value={city}
                    onChange={(event) => setCity(event.target.value)}
                    disabled={!editable}
                  />
                </label>
                <label className="ol-field">
                  <span>Manager</span>
                  <input
                    value={managerName}
                    onChange={(event) => setManagerName(event.target.value)}
                    disabled={!editable}
                  />
                </label>
                <label className="ol-field">
                  <span>Contact phone</span>
                  <input
                    value={contactPhone}
                    onChange={(event) => setContactPhone(event.target.value)}
                    disabled={!editable}
                  />
                </label>
                <label className="ol-field">
                  <span>
                    Week offs (salary deduction)
                    {savingWeekOff && (
                      <small className="ol-saving">Saving...</small>
                    )}
                  </span>
                  <RoundedSelect
                    value={weeklyOffCount}
                    onChange={(event) =>
                      scheduleWeekOffSave(Number(event.target.value))
                    }
                    disabled={!editable || savingWeekOff}
                  >
                    {Array.from({ length: 8 }, (_, count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </RoundedSelect>
                </label>
              </div>
              <div className="ol-foot">
                <div className="ol-users">
                  <strong>Assigned users</strong>
                  {outlet.assignedUsers?.map((user) => (
                    <small key={user.email}>
                      {user.name} · {user.role.replaceAll("_", " ")}
                    </small>
                  ))}
                </div>
                <div className="ol-actions">
                  <label className="ol-check">
                    <span>Available for operations</span>
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(event) => setActive(event.target.checked)}
                      disabled={!editable}
                    />
                  </label>
                  <button
                    className="button button-secondary ol-save"
                    type="button"
                    disabled={!editable || !changed || savingOutlet}
                    onClick={() => {
                      if (
                        outlet.active &&
                        !active &&
                        !window.confirm(
                          `Deactivate ${outlet.code}? Historical records remain accessible.`,
                        )
                      )
                        return;
                      const previousName = outlet.name ?? outlet.code;
                      const codePrefixChanged =
                        getEmployeeCodePrefix(previousName) !==
                        getEmployeeCodePrefix(normalizedName);
                      const employeeCodeUpdateCount = codePrefixChanged
                        ? (outlet.employeeCodeRenameCount ?? 0)
                        : 0;
                      if (
                        employeeCodeUpdateCount > 0 &&
                        !window.confirm(
                          `Is outlet ke ${employeeCodeUpdateCount} employees ke code update honge. Continue?`,
                        )
                      )
                        return;
                      void saveOutlet(
                        {
                          name: normalizedName,
                          active,
                          address,
                          city,
                          managerName,
                          contactPhone,
                        },
                        employeeCodeUpdateCount,
                      );
                    }}
                  >
                    <Check size={15} />{" "}
                    {savingOutlet ? "Saving..." : "Save outlet"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
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
              <RoundedSelect
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
              </RoundedSelect>
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
                        <div key={page.title}>
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
            <RoundedSelect
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
            </RoundedSelect>
          </label>
          <label className="field">
            <span>Assigned outlets</span>
            <RoundedSelect
              multiple
              size={3}
              value={outletIds}
              onChange={(event) =>
                setOutletIds(
                  Array.from(
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
            </RoundedSelect>
          </label>
          {designationId && (
            <small>
              {designations.find((designation) => designation._id === designationId)?.name}
              {" "}permissions sync automatically when the designation is edited.
            </small>
          )}
          {!designationId && (
            <div className="user-permission-groups">
              {designationPermissionGroups.map((group) => (
                <fieldset key={group.title}>
                  <legend>{group.title}</legend>
                  {group.permissions
                    .filter(
                      (permission) =>
                        !designationOnlyPermissionSet.has(permission.value),
                    )
                    .map((permission) => (
                      <label key={permission.value}>
                        <input
                          type="checkbox"
                          checked={
                            role === "MAIN_ADMIN" ||
                            permissions.includes(permission.value)
                          }
                          disabled={role === "MAIN_ADMIN"}
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
              {role === "MAIN_ADMIN" && (
                <fieldset className="admin-only-permissions">
                  <legend>Admin-only pages</legend>
                  {adminOnlyPages.map((page) => (
                    <div key={page.title}>
                      <span>{page.title}</span>
                      <small>MAIN_ADMIN only</small>
                    </div>
                  ))}
                </fieldset>
              )}
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

  function UserDeleteControl({
    item,
    disabled,
    onDelete,
  }: {
    item: UserView;
    disabled: boolean;
    onDelete: () => Promise<void>;
  }) {
    const [isOpen, setIsOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    async function confirmDelete() {
      setBusy(true);
      setError("");
      try {
        await onDelete();
        setIsOpen(false);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Unable to delete user.",
        );
      } finally {
        setBusy(false);
      }
    }

    return (
      <>
        <button
          className="button button-danger"
          type="button"
          disabled={disabled}
          title={disabled ? "You cannot delete your own account." : undefined}
          onClick={() => {
            setError("");
            setIsOpen(true);
          }}
        >
          <Trash2 size={14} /> Delete
        </button>
        {isOpen && (
          <ModalPortal>
            <div className="access-modal-backdrop">
              <section
                className="access-modal employee-delete-modal"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={`user-delete-title-${item._id}`}
                aria-describedby={`user-delete-description-${item._id}`}
              >
                <div className="access-modal-heading">
                  <div>
                    <h2 id={`user-delete-title-${item._id}`}>Delete user?</h2>
                    <p id={`user-delete-description-${item._id}`}>
                      Are you sure you want to delete {item.name} ({item.email})?
                      This action cannot be undone.
                    </p>
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Close delete confirmation"
                    disabled={busy}
                    onClick={() => setIsOpen(false)}
                  >
                    <X size={18} />
                  </button>
                </div>
                {error && <Notice error={error} success="" />}
                <div className="employee-row-actions employee-delete-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() => setIsOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="button button-danger"
                    disabled={busy}
                    onClick={() => void confirmDelete()}
                  >
                    {busy ? "Deleting…" : "Delete user"}
                  </button>
                </div>
              </section>
            </div>
          </ModalPortal>
        )}
      </>
    );
  }

  function EmployeeAttendanceTable({
    rows: providedRows,
    uniformItems: providedUniformItems,
    canReadSalary,
    paginate = false,
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
    uniformItems?: Array<{ key: string; label: string }>;
    canReadSalary: boolean;
    paginate?: boolean;
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
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const report = useEmployeeAttendanceReport({
        enabled: hasLocalFilters,
        from: localFrom,
        to: localTo,
        outletId: localOutletId,
        employeeId: localEmployeeId,
      });
    const rows = providedRows ?? report.rows;
    const employees = report.employees;
    const uniformItems = providedUniformItems ?? report.uniformItems;
    const isFetching = hasLocalFilters && report.isFetching;
    const error = hasLocalFilters ? report.error : "";
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    const currentPage = Math.min(page, pageCount);
    const visibleRows = paginate
      ? rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)
      : rows;
    const sum = (getValue: (row: EmployeeAttendanceReportRow) => number) =>
      rows.reduce((total, row) => total + getValue(row), 0);

    return (
      <section className="panel employee-attendance-report">
        <div className="panel-heading">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          {hasLocalFilters && (
          <div className="toolbar dashboard-report-toolbar">
            <RoundedSelect
              aria-label="Attendance report outlet"
              value={localOutletId}
              onChange={(event) => {
                setPage(1);
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
            </RoundedSelect>
            <RoundedSelect
              aria-label="Attendance report employee"
              value={localEmployeeId}
              onChange={(event) => {
                setPage(1);
                setLocalEmployeeId(event.target.value);
              }}
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
            </RoundedSelect>
            <input
              type="date"
              aria-label="Attendance report from date"
              value={localFrom}
              max={localTo}
              onChange={(event) => {
                setPage(1);
                setLocalFrom(event.target.value);
              }}
            />
            <input
              type="date"
              aria-label="Attendance report to date"
              value={localTo}
              min={localFrom}
              onChange={(event) => {
                setPage(1);
                setLocalTo(event.target.value);
              }}
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
              {canReadSalary ? (
                <>
                  <tr>
                    <th rowSpan={2}>Employee</th>
                    <th rowSpan={2}>Present</th>
                    <th rowSpan={2}>Absent</th>
                    <th rowSpan={2}>Half day</th>
                    <th rowSpan={2}>Week off</th>
                    <th rowSpan={2}>Filled days</th>
                    <th rowSpan={2}>Not marked</th>
                    <th rowSpan={2}>Allowed week off</th>
                    <th rowSpan={2}>Total equivalent days</th>
                    <th rowSpan={2}>Chargeable days</th>
                    <th rowSpan={2}>Attendance deduction</th>
                    <th rowSpan={2}>Not marked deduction</th>
                    <th rowSpan={2}>Used / allowed (days)</th>
                    <th rowSpan={2}>Fixed salary</th>
                    <th rowSpan={2}>Advance details</th>
                    <th rowSpan={2}>Total advances</th>
                    <th rowSpan={2}>Employee ESI</th>
                    <th rowSpan={2}>Employee PF</th>
                    <th rowSpan={2}>Employer PF</th>
                    <th rowSpan={2}>Original loan</th>
                    <th rowSpan={2}>Remaining balance</th>
                    <th rowSpan={2}>Monthly deduction</th>
                    <th rowSpan={2}>Loan deduction</th>
                    <th colSpan={uniformItems.length + 2}>
                      Uniform Deduction
                    </th>
                    <th rowSpan={2}>Payable</th>
                  </tr>
                  <tr>
                    {uniformItems.map((item) => (
                      <th key={item.key}>{item.label}</th>
                    ))}
                    <th>Total Uniform Deduction</th>
                    <th>Remaining Uniform Balance</th>
                  </tr>
                </>
              ) : (
                <tr>
                  <th>Employee</th>
                  <th>Present</th>
                  <th>Absent</th>
                  <th>Half day</th>
                  <th>Week off</th>
                  <th>Filled days</th>
                  <th>Not marked</th>
                </tr>
              )}
            </thead>
            <tbody>
              {visibleRows.map((row) => (
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
                                      {formatDate(date)}
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
                  <td>{row.notMarkedDays ?? row.missingDays}</td>
                  {canReadSalary && (
                    <>
                      <td>{row.allowedWeekOff ?? 3}</td>
                      <td>{row.totalEquivalentDays ?? 0}</td>
                      <td>{row.chargeableDays ?? 0}</td>
                      <td>{currency(row.attendanceDeduction ?? 0)}</td>
                      <td>{currency(row.notMarkedDeduction ?? 0)}</td>
                      <td>
                        {row.allowanceConsumed ?? 0} of {row.allowedWeekOff ?? 3}
                      </td>
                    </>
                  )}
                  {canReadSalary && (
                    <td>{currency(row.monthlyBaseSalary ?? 0)}</td>
                  )}
                  {canReadSalary && (
                    <>
                      <td>
                        <span
                          className="report-advance-details"
                          title={(row.advanceDetails ?? [])
                            .map(
                              (advance) =>
                                `${formatDate(advance.date)}: ${currency(advance.amount)}`,
                            )
                            .join(", ")}
                        >
                          {(row.advanceDetails ?? [])
                            .map(
                              (advance) =>
                                `${formatDate(advance.date)}: ${currency(advance.amount)}`,
                            )
                            .join(", ") || "—"}
                        </span>
                      </td>
                      <td>{currency(row.totalAdvances ?? 0)}</td>
                    </>
                  )}
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
                    <td>{currency(row.loanDeduction ?? 0)}</td>
                  )}
                  {canReadSalary &&
                    uniformItems.map((item) => (
                      <td key={item.key}>
                        {currency(row.uniformDeductionsByItem?.[item.key] ?? 0)}
                      </td>
                    ))}
                  {canReadSalary && (
                    <td>{currency(row.totalUniformDeduction ?? 0)}</td>
                  )}
                  {canReadSalary && (
                    <td>{currency(row.remainingUniformBalance ?? 0)}</td>
                  )}
                  {canReadSalary && (
                    <td>
                      {currency(row.payableAmount ?? 0)}
                      <span className="sub-cell">
                        {row.payableLabel
                          ?.replace(
                            /^Live accrued\s*·\s*submitted days/i,
                            "Submitted days",
                          )
                          .replace(
                            /\b(\d{4})-(\d{2})-(\d{2})\b/g,
                            "$3/$2/$1",
                          )}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>Total</th>
                <td>{sum((row) => row.presentDays)}</td>
                <td>{sum((row) => row.absentDays)}</td>
                <td>{sum((row) => row.halfDays)}</td>
                <td>{sum((row) => row.weekOffs)}</td>
                <td>{sum((row) => row.filledDays)}</td>
                <td>
                  {sum((row) => row.notMarkedDays ?? row.missingDays)}
                </td>
                {canReadSalary && (
                  <>
                    <td>{sum((row) => row.allowedWeekOff ?? 0)}</td>
                    <td>{sum((row) => row.totalEquivalentDays ?? 0)}</td>
                    <td>{sum((row) => row.chargeableDays ?? 0)}</td>
                    <td>{currency(sum((row) => row.attendanceDeduction ?? 0))}</td>
                    <td>{currency(sum((row) => row.notMarkedDeduction ?? 0))}</td>
                    <td>
                      {sum((row) => row.allowanceConsumed ?? 0)} of{" "}
                      {sum((row) => row.allowedWeekOff ?? 0)}
                    </td>
                    <td>{currency(sum((row) => row.monthlyBaseSalary ?? 0))}</td>
                    <td />
                    <td>{currency(sum((row) => row.totalAdvances ?? 0))}</td>
                    <td>{currency(sum((row) => row.esi ?? 0))}</td>
                    <td>{currency(sum((row) => row.employeePf ?? 0))}</td>
                    <td>{currency(sum((row) => row.employerPf ?? 0))}</td>
                    <td>{currency(sum((row) => row.originalLoanAmount ?? 0))}</td>
                    <td>{currency(sum((row) => row.remainingLoanBalance ?? 0))}</td>
                    <td>{currency(sum((row) => row.monthlyLoanDeduction ?? 0))}</td>
                    <td>{currency(sum((row) => row.loanDeduction ?? 0))}</td>
                    {uniformItems.map((item) => (
                      <td key={item.key}>
                        {currency(
                          sum(
                            (row) =>
                              row.uniformDeductionsByItem?.[item.key] ?? 0,
                          ),
                        )}
                      </td>
                    ))}
                    <td>
                      {currency(sum((row) => row.totalUniformDeduction ?? 0))}
                    </td>
                    <td>
                      {currency(sum((row) => row.remainingUniformBalance ?? 0))}
                    </td>
                    <td>{currency(sum((row) => row.payableAmount ?? 0))}</td>
                  </>
                )}
              </tr>
            </tfoot>
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
        {paginate && rows.length > 0 && (
          <TablePagination
            page={currentPage}
            pageSize={pageSize}
            total={rows.length}
            onPageChange={setPage}
            onPageSizeChange={(nextPageSize) => {
              setPageSize(nextPageSize);
              setPage(1);
            }}
          />
        )}
      </section>
    );
  }

  function ReportsPanel({
    outlets,
    enabled,
  }: {
    outlets: Outlet[];
    enabled: boolean;
  }) {
    const [kind, setKind] = useState("attendance");
    const outletPickerRef = useRef<HTMLDetailsElement>(null);
    const [outletSelection, setOutletSelection] = useState<string[] | null>(
      null,
    );
    const selectedOutletIds =
      outletSelection ?? outlets.map((outlet) => outlet._id);
    const selectedOutletId =
      selectedOutletIds.length === 1 ? selectedOutletIds[0] : "";
    const allOutletsSelected = outletSelection === null;
    const outletFilterLabel = allOutletsSelected
      ? "All accessible outlets"
      : selectedOutletIds.length === 0
        ? "Select outlets"
        : selectedOutletIds.length === 1
          ? (() => {
              const outlet = outlets.find(
                (item) => item._id === selectedOutletIds[0],
              );
              return outlet ? `${outlet.code} · ${outlet.name}` : "1 outlet selected";
            })()
          : `${selectedOutletIds.length} outlets selected`;
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
    }).format(new Date());
    const monthStart = `${today.slice(0, 7)}-01`;
    const [from, setFrom] = useState(monthStart);
    const [to, setTo] = useState(today);
    const [fromInput, setFromInput] = useState(() =>
      formatReportDate(monthStart),
    );
    const [toInput, setToInput] = useState(() => formatReportDate(today));
    const fromDatePickerRef = useRef<HTMLInputElement>(null);
    const toDatePickerRef = useRef<HTMLInputElement>(null);
    const [preset, setPreset] = useState("This Month");
    const [busy, setBusy] = useState<ExportFormat | null>(null);
    const [error, setError] = useState("");
    const [employeeId, setEmployeeId] = useState("");
    const dateInputError =
      !parseReportDate(fromInput) || !parseReportDate(toInput)
        ? "Enter dates in DD/MM/YYYY format."
        : "";
    useEffect(() => {
      function closeOutletPicker(event: PointerEvent) {
        const picker = outletPickerRef.current;
        if (
          picker &&
          event.target instanceof Node &&
          !picker.contains(event.target)
        )
          picker.open = false;
      }

      function handleEscape(event: KeyboardEvent) {
        if (event.key === "Escape" && outletPickerRef.current?.open)
          outletPickerRef.current.open = false;
      }

      document.addEventListener("pointerdown", closeOutletPicker);
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.removeEventListener("pointerdown", closeOutletPicker);
        document.removeEventListener("keydown", handleEscape);
      };
    }, []);
    const employeeReport = useEmployeeAttendanceReport({
      enabled:
        enabled && kind === "attendance" && selectedOutletIds.length > 0,
      from,
      to,
      outletId: selectedOutletId,
      outletIds: outletSelection,
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
      setFromInput(formatReportDate(start.toISOString().slice(0, 10)));
      setToInput(formatReportDate(end.toISOString().slice(0, 10)));
    }
    async function exportFile(format: ExportFormat) {
      if (dateInputError) {
        setError(dateInputError);
        return;
      }
      if (selectedOutletIds.length === 0) {
        setError("Select at least one outlet to export.");
        return;
      }
      setBusy(format);
      setError("");
      try {
        const params = new URLSearchParams({ type: kind, from, to, format });
        if (outletSelection !== null)
          selectedOutletIds.forEach((id) => params.append("outletIds", id));
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
      <div className="content-area reports-export-page">
        <PageHead
          title="Reports & exports"
          description="Export permission-checked reports to Excel, CSV, or PDF."
        />
        <Notice
          error={
            error ||
            dateInputError ||
            (kind === "attendance" ? employeeReport.error : "")
          }
          success=""
          refreshing={
            kind === "attendance" && employeeReport.isFetching
          }
        />
        <section className="panel report-panel">
          <div className="form-grid report-filter-grid">
            <label className="field">
              <span>Date range</span>
              <RoundedSelect
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
              </RoundedSelect>
            </label>
            <label className="field">
              <span>Report</span>
              <RoundedSelect
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="attendance">Attendance</option>
                <option value="salary">Monthly salary</option>
                <option value="employees">Employee list</option>
                <option value="advances">Advances</option>
                <option value="audit">Audit log</option>
              </RoundedSelect>
            </label>
            <div className="field report-outlet-filter">
              <span>Outlet</span>
              <details
                ref={outletPickerRef}
                className="report-outlet-picker"
              >
                <summary className="report-outlet-trigger">
                  <span>{outletFilterLabel}</span>
                  <ChevronDown size={16} aria-hidden="true" />
                </summary>
                <div
                  className="report-outlet-options"
                  role="group"
                  aria-label="Accessible outlets"
                >
                  <label className="report-outlet-option">
                    <input
                      type="checkbox"
                      checked={allOutletsSelected}
                      onChange={(event) => {
                        setOutletSelection(event.target.checked ? null : []);
                        setEmployeeId("");
                      }}
                    />
                    <span>All accessible outlets</span>
                  </label>
                  {outlets.map((outlet) => {
                    const checked =
                      allOutletsSelected ||
                      selectedOutletIds.includes(outlet._id);
                    return (
                      <label
                        key={outlet._id}
                        className="report-outlet-option"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            setOutletSelection((current) => {
                              const selected =
                                current ?? outlets.map((item) => item._id);
                              const next = event.target.checked
                                ? [...new Set([...selected, outlet._id])]
                                : selected.filter((id) => id !== outlet._id);
                              return next.length === outlets.length
                                ? null
                                : next;
                            });
                            setEmployeeId("");
                          }}
                        />
                        <span>
                          {outlet.code} · {outlet.name}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </details>
            </div>
            {kind === "attendance" && (
              <label className="field">
                <span>Employee</span>
                <RoundedSelect
                  value={employeeId}
                  onChange={(event) => setEmployeeId(event.target.value)}
                >
                  <option value="">All employees</option>
                  {employeeReport.employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.code} · {employee.name}
                    </option>
                  ))}
                </RoundedSelect>
              </label>
            )}
          </div>
          <div className="report-date-export-row">
            <label className="field">
              <span>From</span>
              <div className="report-date-control">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="DD/MM/YYYY"
                  aria-label="From date (DD/MM/YYYY)"
                  value={fromInput}
                  onChange={(event) => {
                    const value = event.target.value;
                    setFromInput(value);
                    setPreset("Custom");
                    const parsed = parseReportDate(value);
                    if (parsed) setFrom(parsed);
                  }}
                  aria-invalid={Boolean(fromInput && !parseReportDate(fromInput))}
                />
                <CalendarDays
                  className="report-date-icon"
                  size={16}
                  aria-hidden="true"
                />
                <input
                  ref={fromDatePickerRef}
                  className="report-date-picker-native"
                  type="date"
                  aria-label="Choose from date"
                  value={from}
                  onChange={(event) => {
                    setPreset("Custom");
                    setFrom(event.target.value);
                    setFromInput(formatReportDate(event.target.value));
                  }}
                />
              </div>
            </label>
            <label className="field">
              <span>To</span>
              <div className="report-date-control">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="DD/MM/YYYY"
                  aria-label="To date (DD/MM/YYYY)"
                  value={toInput}
                  onChange={(event) => {
                    const value = event.target.value;
                    setToInput(value);
                    setPreset("Custom");
                    const parsed = parseReportDate(value);
                    if (parsed) setTo(parsed);
                  }}
                  aria-invalid={Boolean(toInput && !parseReportDate(toInput))}
                />
                <CalendarDays
                  className="report-date-icon"
                  size={16}
                  aria-hidden="true"
                />
                <input
                  ref={toDatePickerRef}
                  className="report-date-picker-native"
                  type="date"
                  aria-label="Choose to date"
                  value={to}
                  onChange={(event) => {
                    setPreset("Custom");
                    setTo(event.target.value);
                    setToInput(formatReportDate(event.target.value));
                  }}
                />
              </div>
            </label>
            <div className="toolbar">
            <button
              className="button button-primary"
              aria-label="Export Excel workbook"
              disabled={
                busy !== null ||
                Boolean(dateInputError) ||
                from > to ||
                selectedOutletIds.length === 0 ||
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
                Boolean(dateInputError) ||
                from > to ||
                selectedOutletIds.length === 0 ||
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
            {kind === "attendance" && (
              <button
                className="button button-secondary"
                type="button"
                aria-label="Print attendance report or save as PDF"
                disabled={
                  from > to ||
                  Boolean(dateInputError) ||
                  selectedOutletIds.length === 0 ||
                  employeeReport.isFetching
                }
                onClick={() => window.print()}
              >
                <Printer size={16} />
                Print / PDF
              </button>
            )}
            </div>
          </div>
        </section>
        {kind === "attendance" && (
          <div
            className="reports-attendance-results"
            aria-busy={employeeReport.isFetching}
          >
              {selectedOutletIds.length === 0 && (
                <p className="sub-cell" role="status">
                  Select at least one outlet to preview or export a report.
                </p>
              )}
              {employeeReport.canReadSalary && (
                <p className="sub-cell">
                  Payable shows live accrued salary from submitted attendance for
                  the selected dates. Missing or unsubmitted days are not treated
                  as absences.
                </p>
              )}
              <AttendanceTrendChart
                rows={
                  selectedOutletIds.length > 0 ? employeeReport.rows : []
                }
                from={from}
                to={to}
              />
              <EmployeeAttendanceTable
                rows={
                  selectedOutletIds.length > 0 ? employeeReport.rows : []
                }
                uniformItems={employeeReport.uniformItems}
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
              countTodayAsNotMarked: values.get("countTodayAsNotMarked") === "on",
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
            <label className="payroll-not-marked-toggle">
              <span className="payroll-not-marked-copy">
                <strong>Today&apos;s missing attendance</strong>
                <small>Count as not marked in payroll</small>
              </span>
              <span className="payroll-switch">
                <input
                  type="checkbox"
                  name="countTodayAsNotMarked"
                  defaultChecked={settings.countTodayAsNotMarked ?? true}
                  disabled={user.role !== "MAIN_ADMIN"}
                />
                <i aria-hidden="true" />
              </span>
            </label>
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
