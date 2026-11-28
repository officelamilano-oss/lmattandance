"use client";

import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Columns3,
  Copy,
  Download,
  FileSpreadsheet,
  Filter,
  LoaderCircle,
  Pencil,
  Printer,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { formatFaceAttendanceDuration } from "@/lib/face-attendance-report";

type OutletOption = { id: string; code: string; name: string };
type EmployeeOption = {
  id: string;
  code: string;
  name: string;
  outletId: string;
  active: boolean;
};
type LogRow = {
  _id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  outletId: string;
  outletCode: string;
  outletName: string;
  companyName: string;
  clockIn: string | null;
  clockOut: string | null;
  durationSeconds: number | null;
  shiftDurationHours?: number;
  statusTag: string;
  createdAt: string;
  missingClockOut?: boolean;
  editedAt?: string | null;
  editor?: { name: string; email: string } | null;
};
type SummaryRow = {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  outletCode: string;
  outletName: string;
  shiftHours: number | null;
  daysPunched: number;
  entries: number;
  totalSeconds: number;
  averageSecondsPerDay: number;
  openEntries: number;
};
type ReportResponse = {
  view: "logs" | "summary";
  rows: LogRow[] | SummaryRow[];
  page: number;
  pageSize: number;
  total: number;
  summary: {
    totalEntries: number;
    totalSeconds: number;
    openEntries: number;
  };
};
type DateRange = { from: string; to: string };

const pageSizes = [10, 25, 50, 100] as const;
const datePresets = [
  "Today",
  "Yesterday",
  "Last 7 Days",
  "Last 30 Days",
  "This Month",
  "Last Month",
  "Custom Range",
] as const;
type DatePreset = (typeof datePresets)[number];
type LogSort = "clockIn" | "clockOut" | "employeeName" | "employeeCode" | "outletName" | "totalHours" | "createdAt";
type SummarySort = "employeeName" | "employeeCode" | "outletName" | "daysPunched" | "totalHours" | "averageHours" | "openEntries";

const logColumns = [
  ["srNo", "Sr. No."],
  ["company", "Company Name"],
  ["location", "Location Name"],
  ["employee", "Employee Name"],
  ["user", "User Name"],
  ["clockIn", "Clock In"],
  ["clockOut", "Clock Out"],
  ["totalHours", "Total Hours"],
  ["createdAt", "Created Date"],
] as const;

function localDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function currentMonth(date: string) {
  return date.slice(0, 7);
}

function monthRange(month: string): DateRange {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  if (!year || monthNumber < 1 || monthNumber > 12)
    return { from: localDate(), to: localDate() };
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    from: `${yearText}-${monthText}-01`,
    to: `${yearText}-${monthText}-${String(lastDay).padStart(2, "0")}`,
  };
}

function rangeForPreset(preset: DatePreset): DateRange {
  const today = localDate();
  if (preset === "Yesterday") {
    const yesterday = addDays(today, -1);
    return { from: yesterday, to: yesterday };
  }
  if (preset === "Last 7 Days")
    return { from: addDays(today, -6), to: today };
  if (preset === "Last 30 Days")
    return { from: addDays(today, -29), to: today };
  if (preset === "This Month")
    return { from: `${today.slice(0, 7)}-01`, to: today };
  if (preset === "Last Month") {
    const previous = addDays(`${today.slice(0, 7)}-01`, -1);
    return monthRange(currentMonth(previous));
  }
  return { from: today, to: today };
}

function formatTimestamp(value: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "medium",
    hour12: false,
  }).format(date);
}

function toLocalDateTimeInput(value: string | null) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}T${values.get("hour")}:${values.get("minute")}`;
}

function formatRequestError(payload: unknown, fallback: string) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  )
    return payload.error;
  return fallback;
}

export function FaceAttendanceLogReport({
  canEditClockOut,
}: {
  canEditClockOut: boolean;
}) {
  const today = useMemo(() => localDate(), []);
  const [preset, setPreset] = useState<DatePreset>("Today");
  const [dateRange, setDateRange] = useState<DateRange>({
    from: today,
    to: today,
  });
  const [monthValue, setMonthValue] = useState(currentMonth(today));
  const [outlets, setOutlets] = useState<OutletOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selectedOutlets, setSelectedOutlets] = useState<string[]>([]);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [outletSearch, setOutletSearch] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [searchText, setSearchText] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [view, setView] = useState<"logs" | "summary">("logs");
  const [rows, setRows] = useState<Array<LogRow | SummaryRow>>([]);
  const [summary, setSummary] = useState({
    totalEntries: 0,
    totalSeconds: 0,
    openEntries: 0,
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState<LogSort | SummarySort>("clockIn");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    logColumns.map(([key]) => key),
  );
  const [loading, setLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [editing, setEditing] = useState<LogRow | null>(null);
  const [clockOutInput, setClockOutInput] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const visibleEmployees = useMemo(
    () =>
      employees.filter(
        (employee) =>
          (!selectedOutlets.length ||
            selectedOutlets.includes(employee.outletId)) &&
          `${employee.code} ${employee.name}`
            .toLowerCase()
            .includes(employeeSearch.trim().toLowerCase()),
      ),
    [employees, employeeSearch, selectedOutlets],
  );
  const filteredOutlets = outlets.filter((outlet) =>
    `${outlet.code} ${outlet.name}`
      .toLowerCase()
      .includes(outletSearch.trim().toLowerCase()),
  );

  useEffect(() => {
    let active = true;
    void fetch("/api/face-attendance-logs?options=1", {
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok)
          throw new Error(
            formatRequestError(payload, "Unable to load report filters."),
          );
        if (active) {
          setOutlets(payload.outlets ?? []);
          setEmployees(payload.employees ?? []);
        }
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load report filters.",
          );
      })
      .finally(() => {
        if (active) setOptionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setAppliedSearch(searchText.trim()),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    let active = true;
    const loadReport = async () => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({
        from: dateRange.from,
        to: dateRange.to,
        view,
        page: String(page),
        pageSize: String(pageSize),
        sort,
        direction,
      });
      selectedOutlets.forEach((id) => params.append("outletId", id));
      selectedEmployees.forEach((id) => params.append("employeeId", id));
      if (appliedSearch) params.set("search", appliedSearch);
      try {
        const response = await fetch(
          `/api/face-attendance-logs?${params.toString()}`,
          { cache: "no-store" },
        );
        const payload = await response.json();
        if (!response.ok)
          throw new Error(
            formatRequestError(payload, "Unable to load the face log report."),
          );
        const result = payload as ReportResponse;
        if (active) {
          setRows(result.rows ?? []);
          setSummary(result.summary ?? { totalEntries: 0, totalSeconds: 0, openEntries: 0 });
          setTotal(result.total ?? 0);
        }
      } catch (caught) {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load the face log report.",
          );
      } finally {
        if (active) setLoading(false);
      }
    };
    void Promise.resolve().then(loadReport);
    return () => {
      active = false;
    };
  }, [
    appliedSearch,
    dateRange.from,
    dateRange.to,
    direction,
    page,
    pageSize,
    refreshKey,
    selectedEmployees,
    selectedOutlets,
    sort,
    view,
  ]);

  function applyDateRange() {
    setPage(1);
    setMonthValue(currentMonth(dateRange.from));
    setRefreshKey((key) => key + 1);
  }

  function selectPreset(next: DatePreset) {
    setPreset(next);
    if (next !== "Custom Range") {
      setDateRange(rangeForPreset(next));
      setMonthValue(currentMonth(rangeForPreset(next).from));
    }
  }

  function selectMonth(value: string) {
    if (!value) return;
    const nextRange = monthRange(value);
    setMonthValue(value);
    setPreset("Custom Range");
    setDateRange(nextRange);
    setPage(1);
  }

  function toggleOutlet(id: string) {
    const nextOutletIds = selectedOutlets.includes(id)
      ? selectedOutlets.filter((value) => value !== id)
      : [...selectedOutlets, id];
    setSelectedOutlets(nextOutletIds);
    setSelectedEmployees((current) =>
      current.filter((employeeId) => {
        const employee = employees.find((item) => item.id === employeeId);
        return (
          employee !== undefined &&
          (!nextOutletIds.length || nextOutletIds.includes(employee.outletId))
        );
      }),
    );
  }

  function toggleAllOutlets() {
    setSelectedOutlets((current) =>
      current.length === outlets.length ? [] : outlets.map((item) => item.id),
    );
    setSelectedEmployees([]);
  }

  function toggleEmployee(id: string) {
    setSelectedEmployees((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }

  function toggleAllEmployees() {
    setSelectedEmployees((current) =>
      current.length === visibleEmployees.length
        ? current.filter(
            (id) => !visibleEmployees.some((employee) => employee.id === id),
          )
        : [
            ...new Set([
              ...current,
              ...visibleEmployees.map((employee) => employee.id),
            ]),
          ],
    );
  }

  function updateSort(field: LogSort | SummarySort) {
    if (sort === field) setDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSort(field);
      setDirection("asc");
    }
    setPage(1);
  }

  function reportParams() {
    const params = new URLSearchParams({
      from: dateRange.from,
      to: dateRange.to,
      search: appliedSearch,
    });
    selectedOutlets.forEach((id) => params.append("outletId", id));
    selectedEmployees.forEach((id) => params.append("employeeId", id));
    return params;
  }

  async function exportReport(format: "csv" | "xlsx" | "pdf" | "copy" | "print") {
    setNotice("");
    const params = reportParams();
    params.set("format", format === "print" ? "pdf" : format);
    const url = `/api/face-attendance-logs?${params.toString()}`;
    if (format === "pdf" || format === "print") {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(
          formatRequestError(payload, "Unable to export face attendance logs."),
        );
      }
      if (format === "copy") {
        await navigator.clipboard.writeText(await response.text());
        setNotice("Filtered report copied.");
        return;
      }
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `face-attendance-log_${dateRange.from}_${dateRange.to}.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to export face attendance logs.",
      );
    }
  }

  function startEdit(row: LogRow) {
    setEditing(row);
    setClockOutInput(toLocalDateTimeInput(row.clockOut));
    setEditReason("");
  }

  async function saveClockOut(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setEditBusy(true);
    setError("");
    try {
      const clockOut = new Date(`${clockOutInput}:00+05:30`);
      if (Number.isNaN(clockOut.getTime()))
        throw new Error("Enter a valid clock-out time.");
      const response = await fetch(
        `/api/face-attendance-logs/${encodeURIComponent(editing._id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clockOut: clockOut.toISOString(),
            reason: editReason,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          formatRequestError(payload, "Unable to update clock-out."),
        );
      setEditing(null);
      setNotice("Clock-out updated and recorded in Active Logs.");
      setRefreshKey((key) => key + 1);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to update clock-out.",
      );
    } finally {
      setEditBusy(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const isSummary = view === "summary";

  return (
    <div className="content-area face-log-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">LA MILANO · OPERATIONS</p>
          <h1>Face Attendance Log Report</h1>
          <p>Face clock-in and clock-out history only. No attendance or payroll marking.</p>
        </div>
        <div className="face-log-export-actions">
          <button className="button button-secondary button-small" onClick={() => void exportReport("copy")}><Copy size={15} /> Copy</button>
          <button className="button button-secondary button-small" onClick={() => void exportReport("csv")}><Download size={15} /> CSV</button>
          <button className="button button-secondary button-small" onClick={() => void exportReport("xlsx")}><FileSpreadsheet size={15} /> Excel</button>
          <button className="button button-secondary button-small" onClick={() => void exportReport("pdf")}>PDF</button>
          <button className="button button-secondary button-small" onClick={() => void exportReport("print")}><Printer size={15} /> Print</button>
        </div>
      </header>

      <section className="panel face-log-filters" aria-label="Face log filters">
        <label className="field">
          <span>Date Range</span>
          <select
            value={preset}
            onChange={(event) => selectPreset(event.target.value as DatePreset)}
          >
            {datePresets.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Month quick select</span>
          <input
            type="month"
            value={monthValue}
            onChange={(event) => selectMonth(event.target.value)}
          />
        </label>
        {preset === "Custom Range" && (
          <>
            <label className="field">
              <span>From</span>
              <input
                type="date"
                value={dateRange.from}
                onChange={(event) => setDateRange((range) => ({ ...range, from: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>To</span>
              <input
                type="date"
                value={dateRange.to}
                onChange={(event) => setDateRange((range) => ({ ...range, to: event.target.value }))}
              />
            </label>
          </>
        )}
        <MultiPicker
          label="Location"
          allLabel="All outlets"
          search={outletSearch}
          setSearch={setOutletSearch}
          options={filteredOutlets.map((item) => ({ id: item.id, label: `${item.code} · ${item.name}` }))}
          selected={selectedOutlets}
          onToggle={toggleOutlet}
          onToggleAll={toggleAllOutlets}
          allSelected={outlets.length > 0 && selectedOutlets.length === outlets.length}
          loading={optionsLoading}
        />
        <MultiPicker
          label="User List"
          allLabel="All employees"
          search={employeeSearch}
          setSearch={setEmployeeSearch}
          options={visibleEmployees.map((item) => ({ id: item.id, label: `${item.code} · ${item.name}` }))}
          selected={selectedEmployees}
          onToggle={toggleEmployee}
          onToggleAll={toggleAllEmployees}
          allSelected={visibleEmployees.length > 0 && visibleEmployees.every((item) => selectedEmployees.includes(item.id))}
          loading={optionsLoading}
        />
        <button
          className="button button-primary face-log-filter-button"
          disabled={loading}
          onClick={applyDateRange}
        >
          <Filter size={16} /> Filter
        </button>
      </section>

      <div className="face-log-viewbar">
        <div className="face-log-view-toggle" role="group" aria-label="Report view">
          <button className={view === "logs" ? "is-selected" : ""} onClick={() => { setView("logs"); setPage(1); setSort("clockIn"); }}>Log View</button>
          <button className={view === "summary" ? "is-selected" : ""} onClick={() => { setView("summary"); setPage(1); setSort("employeeName"); }}>Employee Summary</button>
        </div>
        <label className="face-log-search">
          <Search size={16} aria-hidden="true" />
          <input
            placeholder="Type to filter..."
            value={searchText}
            onChange={(event) => { setSearchText(event.target.value); setPage(1); }}
          />
        </label>
        {!isSummary && (
          <details
            className="face-log-column-picker"
            open={columnsOpen}
            onToggle={(event) => setColumnsOpen(event.currentTarget.open)}
          >
            <summary className="button button-secondary button-small"><Columns3 size={15} /> Columns</summary>
            <div className="face-log-column-menu">
              {logColumns.map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={visibleColumns.includes(key)}
                    onChange={() => setVisibleColumns((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])}
                  />
                  {label}
                </label>
              ))}
            </div>
          </details>
        )}
      </div>

      {(error || notice) && (
        <div className={error ? "face-log-notice is-error" : "face-log-notice"} role={error ? "alert" : "status"}>
          <span>{error || notice}</span>
          <button aria-label="Dismiss message" onClick={() => { setError(""); setNotice(""); }}><X size={15} /></button>
        </div>
      )}

      <section className="panel face-log-table-panel">
        <div className="panel-heading">
          <div>
            <h2>{isSummary ? "Employee summary" : "Face punch entries"}</h2>
            <p>All times shown in Asia/Kolkata (IST). Date filter follows the clock-in date; clock-out-only rows use their clock-out date.</p>
          </div>
          {loading && <LoaderCircle className="spin" size={18} aria-label="Loading report" />}
        </div>
        <div className="face-log-table-wrap">
          <table className="face-log-table">
            {isSummary ? (
              <>
                <thead>
                  <tr>
                    <SortableHeader label="Employee" field="employeeName" sort={sort} direction={direction} onSort={updateSort} />
                    <SortableHeader label="User Name" field="employeeCode" sort={sort} direction={direction} onSort={updateSort} />
                    <SortableHeader label="Location" field="outletName" sort={sort} direction={direction} onSort={updateSort} />
                    <SortableHeader label="Days punched" field="daysPunched" sort={sort} direction={direction} onSort={updateSort} />
                    <SortableHeader label="Total hours" field="totalHours" sort={sort} direction={direction} onSort={updateSort} />
                    <SortableHeader label="Average / day" field="averageHours" sort={sort} direction={direction} onSort={updateSort} />
                    <SortableHeader label="Open entries" field="openEntries" sort={sort} direction={direction} onSort={updateSort} />
                  </tr>
                </thead>
                <tbody>
                  {(rows as SummaryRow[]).map((row) => (
                    <tr key={row.employeeId}>
                      <td><strong>{row.employeeName}</strong></td>
                      <td>{row.employeeCode}</td>
                      <td>{row.outletCode} · {row.outletName}</td>
                      <td>{row.daysPunched}</td>
                      <td>{formatFaceAttendanceDuration(row.totalSeconds)}</td>
                      <td>{formatFaceAttendanceDuration(Math.floor(row.averageSecondsPerDay))}</td>
                      <td>{row.openEntries}</td>
                    </tr>
                  ))}
                </tbody>
              </>
            ) : (
              <>
                <thead>
                  <tr>
                    {logColumns.map(([key, label]) => {
                      if (!visibleColumns.includes(key)) return null;
                      if (key === "srNo" || key === "company" || key === "location" || key === "employee" || key === "user")
                        return <th key={key}>{label}</th>;
                      const fields: Record<string, LogSort> = {
                        clockIn: "clockIn",
                        clockOut: "clockOut",
                        totalHours: "totalHours",
                        createdAt: "createdAt",
                      };
                      return <SortableHeader key={key} label={label} field={fields[key]} sort={sort} direction={direction} onSort={updateSort} />;
                    })}
                  </tr>
                </thead>
                <tbody>
                  {(rows as LogRow[]).map((row, index) => (
                    <tr key={row._id}>
                      {visibleColumns.includes("srNo") && <td>{(page - 1) * pageSize + index + 1}</td>}
                      {visibleColumns.includes("company") && <td>{row.companyName}</td>}
                      {visibleColumns.includes("location") && <td>{row.outletCode} · {row.outletName}</td>}
                      {visibleColumns.includes("employee") && <td><strong>{row.employeeName}</strong></td>}
                      {visibleColumns.includes("user") && <td>{row.employeeCode}</td>}
                      {visibleColumns.includes("clockIn") && <td>{formatTimestamp(row.clockIn)}</td>}
                      {visibleColumns.includes("clockOut") && (
                        <td>
                          {formatTimestamp(row.clockOut)}
                          {canEditClockOut &&
                            row.clockIn &&
                            ["Check", "Missing Clock Out", "Open (No Clock Out)"].includes(row.statusTag) && (
                              <button
                                className="button button-secondary button-small"
                                onClick={() => startEdit(row)}
                              >
                                <Pencil size={14} /> Edit
                              </button>
                            )}
                        </td>
                      )}
                      {visibleColumns.includes("totalHours") && (
                        <td>
                          {formatFaceAttendanceDuration(row.durationSeconds)}
                          {row.statusTag === "Check" && (
                            <span className="face-log-status is-warning">Check</span>
                          )}
                        </td>
                      )}
                      {visibleColumns.includes("createdAt") && (
                        <td>
                          {formatTimestamp(row.createdAt)}
                          {row.editedAt && (
                            <small className="face-log-edit-meta">
                              Edited {formatTimestamp(row.editedAt)} · {row.editor?.name ?? "Administrator"}
                            </small>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </table>
          {!loading && rows.length === 0 && (
            <div className="face-log-empty">No data available in table</div>
          )}
        </div>
        <footer className="face-log-pagination">
          <span>{total} {isSummary ? "employees" : "entries"} · page {page} of {totalPages}</span>
          <label>
            Rows
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
              {pageSizes.map((size) => <option key={size}>{size}</option>)}
            </select>
          </label>
          <button className="icon-button" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={17} /></button>
          <span>{page}</span>
          <button className="icon-button" aria-label="Next page" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}><ChevronRight size={17} /></button>
        </footer>
      </section>

      <section className="face-log-summary-bar" aria-label="Filtered report totals">
        <div><span>Total entries</span><strong>{summary.totalEntries.toLocaleString()}</strong></div>
        <div><span>Total hours</span><strong>{formatFaceAttendanceDuration(summary.totalSeconds)}</strong></div>
        <div><span>Open entries</span><strong>{summary.openEntries.toLocaleString()}</strong></div>
      </section>

      {editing && (
        <div className="face-log-modal-backdrop">
          <section className="face-log-edit-modal" role="dialog" aria-modal="true" aria-labelledby="face-log-edit-title">
            <header>
              <div>
                <h2 id="face-log-edit-title">Edit clock out</h2>
                <p>{editing.employeeCode} · {editing.employeeName}</p>
              </div>
              <button className="icon-button" aria-label="Close dialog" onClick={() => setEditing(null)}><X size={18} /></button>
            </header>
            <form onSubmit={(event) => void saveClockOut(event)}>
              <label className="field">
                <span>Clock-out time (IST)</span>
                <input type="datetime-local" value={clockOutInput} onChange={(event) => setClockOutInput(event.target.value)} required />
              </label>
              <label className="field">
                <span>Reason for correction</span>
                <textarea value={editReason} onChange={(event) => setEditReason(event.target.value)} minLength={2} maxLength={500} required />
              </label>
              <div className="form-actions">
                <button type="button" className="button button-secondary" disabled={editBusy} onClick={() => setEditing(null)}>Cancel</button>
                <button className="button button-primary" disabled={editBusy}>{editBusy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Save clock out</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function SortableHeader<T extends string>({
  label,
  field,
  sort,
  direction,
  onSort,
}: {
  label: string;
  field: T;
  sort: string;
  direction: "asc" | "desc";
  onSort: (field: T) => void;
}) {
  const selected = sort === field;
  return (
    <th>
      <button className="face-log-sort-button" onClick={() => onSort(field)}>
        {label}
        {selected ? direction === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} /> : null}
      </button>
    </th>
  );
}

function MultiPicker({
  label,
  allLabel,
  search,
  setSearch,
  options,
  selected,
  onToggle,
  onToggleAll,
  allSelected,
  loading,
}: {
  label: string;
  allLabel: string;
  search: string;
  setSearch: (value: string) => void;
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  allSelected: boolean;
  loading: boolean;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeOnOutside = (event: MouseEvent) => {
      const element = detailsRef.current;
      if (element?.open && !element.contains(event.target as Node)) element.open = false;
    };
    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, []);

  return (
    <div className="face-log-field face-log-multi-picker">
      <span className="face-log-field-label">{label}</span>
      <details ref={detailsRef} className="face-log-multi-details">
        <summary className="face-log-multi-trigger">
          <strong>{selected.length ? `${selected.length} selected` : allLabel}</strong>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="face-log-multi-menu">
          <label className="face-log-picker-search">
            <Search size={14} aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} />
          </label>
          <button type="button" className="face-log-select-all" onClick={onToggleAll}>
            <input type="checkbox" checked={allSelected} readOnly />
            Select All
          </button>
          <div className="face-log-picker-options">
            {loading ? <span className="muted">Loading…</span> : options.map((option) => (
              <label key={option.id}>
                <input type="checkbox" checked={selected.includes(option.id)} onChange={() => onToggle(option.id)} />
                <span>{option.label}</span>
              </label>
            ))}
            {!loading && !options.length && <span className="muted">No matching options.</span>}
          </div>
        </div>
      </details>
    </div>
  );
}
