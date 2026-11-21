"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Download, LoaderCircle, Printer, Search, Trash2 } from "lucide-react";
import { UNIFORM_ITEMS, UNIFORM_ITEM_LABELS } from "@/lib/uniform-deductions";
import type { UniformDeductionStatus, UniformItemKey } from "@/lib/models";
import { clientRequestCache } from "@/lib/client-request-cache";
import { fetchOutletList } from "@/lib/outlets-client";

type OutletOption = { _id: string; code: string; name: string };
type EmployeeOption = {
  _id: string;
  outletId: string;
  fullName: string;
  employeeCode: string;
  mobile?: string;
};
type DeductionRow = {
  _id: string;
  employeeId: string;
  outletId: string;
  employeeName: string;
  employeeCode: string;
  mobile?: string;
  outletCode: string;
  item: UniformItemKey;
  amount: number;
  deductionMonth: string;
  status: UniformDeductionStatus;
  remark?: string;
};
type DraftItem = {
  selected: boolean;
  amount: string;
  deductionMonth: string;
  remark: string;
};

function currentIndiaMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

function emptyDraft(): Record<UniformItemKey, DraftItem> {
  return Object.fromEntries(
    UNIFORM_ITEMS.map((item) => [
      item,
      { selected: false, amount: "", deductionMonth: "", remark: "" },
    ]),
  ) as Record<UniformItemKey, DraftItem>;
}

function currency(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(amount);
}

export function UniformDeductionPanel({
  canExport,
  cacheScope,
}: {
  canExport: boolean;
  cacheScope: string;
}) {
  const [outlets, setOutlets] = useState<OutletOption[]>([]);
  const [outletId, setOutletId] = useState("");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [reportOutletId, setReportOutletId] = useState("");
  const [reportEmployeeId, setReportEmployeeId] = useState("");
  const [reportEmployeeQuery, setReportEmployeeQuery] = useState("");
  const [reportEmployees, setReportEmployees] = useState<EmployeeOption[]>([]);
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [rows, setRows] = useState<DeductionRow[]>([]);
  const [printRows, setPrintRows] = useState<DeductionRow[] | null>(null);
  const [itemFilter, setItemFilter] = useState("ALL");
  const [monthFilter, setMonthFilter] = useState(currentIndiaMonth);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 25;

  const loadRows = useCallback(async (signal?: AbortSignal) => {
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        status: statusFilter,
      });
      if (reportOutletId) params.set("outletId", reportOutletId);
      if (itemFilter !== "ALL") params.set("item", itemFilter);
      if (monthFilter) params.set("month", monthFilter);
      if (reportEmployeeId) params.set("employeeId", reportEmployeeId);
      const response = await fetch(`/api/uniform-deductions?${params}`, {
        cache: "no-store",
        signal,
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Unable to load uniform deductions.");
      setError("");
      setRows(body.deductions);
      setTotal(body.total);
    } catch (caught) {
      if (signal?.aborted) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to load uniform deductions.",
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [itemFilter, monthFilter, page, reportEmployeeId, reportOutletId, statusFilter]);

  useEffect(() => {
    void clientRequestCache.get(
      cacheScope,
      "/api/outlets",
      120_000,
      fetchOutletList,
    )
      .then(setOutlets)
      .catch((caught: unknown) => {
        setOutlets([]);
        setError(
          caught instanceof Error ? caught.message : "Unable to load outlets.",
        );
      });
  }, [cacheScope]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (!outletId) {
        setEmployees([]);
        return;
      }
      const params = new URLSearchParams({
        outletId,
        pageSize: "100",
        active: "true",
      });
      if (employeeQuery.trim()) params.set("q", employeeQuery.trim());
      void fetch(`/api/employees?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok)
            throw new Error(body.error ?? "Unable to search employees.");
          setEmployees(body.employees);
        })
        .catch((caught: unknown) =>
          !controller.signal.aborted &&
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to search employees.",
          ),
        );
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [employeeQuery, outletId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ pageSize: "100", active: "true" });
      if (reportOutletId) params.set("outletId", reportOutletId);
      if (reportEmployeeQuery.trim()) params.set("q", reportEmployeeQuery.trim());
      void fetch(`/api/employees?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok)
            throw new Error(body.error ?? "Unable to load employee filters.");
          setReportEmployees(body.employees);
        })
        .catch((caught: unknown) =>
          !controller.signal.aborted &&
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load employee filters.",
          ),
        );
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [reportEmployeeQuery, reportOutletId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadRows(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadRows]);

  useEffect(() => {
    if (!printRows) return;
    const finishPrint = () => {
      setPrintRows(null);
      void loadRows();
    };
    window.addEventListener("afterprint", finishPrint);
    const timer = window.setTimeout(() => window.print(), 150);
    return () => {
      window.removeEventListener("afterprint", finishPrint);
      window.clearTimeout(timer);
    };
  }, [loadRows, printRows]);

  const selectedEmployee = employees.find((employee) => employee._id === employeeId);
  const totalAmount = useMemo(
    () =>
      UNIFORM_ITEMS.reduce((total, item) => {
        const value = Number(draft[item].amount);
        return total + (Number.isFinite(value) ? value : 0);
      }, 0),
    [draft],
  );
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  function updateDraft(item: UniformItemKey, patch: Partial<DraftItem>) {
    setDraft((current) => ({
      ...current,
      [item]: { ...current[item], ...patch },
    }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employeeId || !outletId) return;
    const entries = UNIFORM_ITEMS.map((item) => ({
      item,
      selected: draft[item].selected,
      ...(draft[item].amount.trim()
        ? { amount: Number(draft[item].amount) }
        : {}),
      deductionMonth: draft[item].deductionMonth,
      remark: draft[item].remark,
    }));
    if (!entries.some((entry) => entry.selected || entry.amount !== undefined))
      return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/uniform-deductions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outletId, employeeId, entries }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Unable to save uniform deductions.");
      setDraft(emptyDraft());
      setSuccess(
        `${body.deductions.length} uniform deduction(s) saved.`,
      );
      await loadRows();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to save uniform deductions.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function updateDeduction(
    id: string,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const amount = String(values.get("amount") ?? "").trim();
    const body = {
      ...(amount ? { amount: Number(amount) } : {}),
      deductionMonth: String(values.get("deductionMonth") ?? ""),
      remark: String(values.get("remark") ?? ""),
    };
    await mutate(`/api/uniform-deductions/${id}`, "PATCH", body);
  }

  async function mutate(url: string, method: "PATCH" | "DELETE", body?: unknown) {
    setError("");
    setSuccess("");
    try {
      const response = await fetch(url, {
        method,
        ...(body
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Unable to update uniform deduction.");
      setSuccess(
        method === "DELETE"
          ? "Uniform deduction deleted."
          : "Uniform deduction updated.",
      );
      await loadRows();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to update uniform deduction.",
      );
    }
  }

  async function downloadExcel() {
    const params = new URLSearchParams({ format: "xlsx" });
    if (reportOutletId) params.set("outletId", reportOutletId);
    if (reportEmployeeId) params.set("employeeId", reportEmployeeId);
    if (itemFilter !== "ALL") params.set("item", itemFilter);
    if (monthFilter) params.set("month", monthFilter);
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    try {
      const response = await fetch(`/api/uniform-deductions/export?${params}`);
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? "Unable to export uniform deductions.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `uniform-deductions-${monthFilter || "all-months"}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to export uniform deductions.",
      );
    }
  }

  async function printReport() {
    const params = new URLSearchParams({
      page: "1",
      pageSize: "100",
      status: statusFilter,
    });
    if (reportOutletId) params.set("outletId", reportOutletId);
    if (reportEmployeeId) params.set("employeeId", reportEmployeeId);
    if (itemFilter !== "ALL") params.set("item", itemFilter);
    if (monthFilter) params.set("month", monthFilter);
    try {
      const firstResponse = await fetch(`/api/uniform-deductions?${params}`, {
        cache: "no-store",
      });
      const firstBody = await firstResponse.json();
      if (!firstResponse.ok)
        throw new Error(firstBody.error ?? "Unable to prepare the report.");
      const allRows: DeductionRow[] = [...firstBody.deductions];
      const pageCount = Math.ceil(firstBody.total / 100);
      for (let currentPage = 2; currentPage <= pageCount; currentPage += 1) {
        params.set("page", String(currentPage));
        const response = await fetch(`/api/uniform-deductions?${params}`, {
          cache: "no-store",
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? "Unable to prepare the report.");
        allRows.push(...body.deductions);
      }
      setPrintRows(allRows);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to prepare the report.",
      );
    }
  }

  const displayedRows = printRows ?? rows;

  return (
    <main className="content-area uniform-deductions-page">
      <header className="page-head">
        <div>
          <div className="eyebrow">LA MILANO / PAYROLL</div>
          <h1>Uniform deduction</h1>
          <p>Schedule and review one-time employee uniform deductions.</p>
        </div>
        <div className="toolbar uniform-report-actions">
          {canExport && (
            <button type="button" className="button" onClick={() => void downloadExcel()}>
              <Download size={16} /> Excel
            </button>
          )}
          <button type="button" className="button" onClick={() => void printReport()}>
            <Printer size={16} /> Print / PDF
          </button>
        </div>
      </header>

      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {success && <div className="notice notice-success" role="status">{success}</div>}

      <section className="panel uniform-entry-panel">
        <div className="panel-heading">
          <div>
            <h2>New deduction</h2>
            <p>Leave amount and month blank if they are not needed. Blank month uses the current month.</p>
          </div>
        </div>
        <form onSubmit={(event) => void save(event)}>
          <div className="uniform-selectors">
            <label className="field">
              <span>Outlet</span>
              <select
                value={outletId}
                onChange={(event) => {
                  setOutletId(event.target.value);
                  setEmployeeId("");
                  setEmployeeQuery("");
                }}
              >
                <option value="">Select outlet</option>
                {(outlets ?? []).map((outlet) => (
                  <option key={outlet._id} value={outlet._id}>
                    {outlet.code} · {outlet.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field uniform-employee-search">
              <span>Search employee by name, ID, or mobile</span>
              <div className="search-field">
                <Search size={16} />
                <input
                  value={selectedEmployee?.fullName ?? employeeQuery}
                  onFocus={() => setEmployeePickerOpen(true)}
                  onChange={(event) => {
                    setEmployeeId("");
                    setEmployeeQuery(event.target.value);
                    setEmployeePickerOpen(true);
                  }}
                  placeholder={outletId ? "Type employee name, ID, or mobile" : "Select outlet first"}
                  disabled={!outletId}
                  aria-label="Search employee"
                />
              </div>
              {employeePickerOpen && outletId && !selectedEmployee && (
                <div className="uniform-employee-options">
                  {employees.length ? employees.map((employee) => (
                    <button
                      type="button"
                      key={employee._id}
                      onClick={() => {
                        setEmployeeId(employee._id);
                        setEmployeeQuery(employee.fullName);
                        setEmployeePickerOpen(false);
                      }}
                    >
                      <strong>{employee.fullName}</strong>
                      <span>{employee.employeeCode} · {employee.mobile || "No mobile"}</span>
                    </button>
                  )) : <span className="muted">No matching active employees.</span>}
                </div>
              )}
              {selectedEmployee && (
                <button
                  className="uniform-clear-employee"
                  type="button"
                  onClick={() => {
                    setEmployeeId("");
                    setEmployeeQuery("");
                    setEmployeePickerOpen(true);
                  }}
                >
                  {selectedEmployee.employeeCode} · {selectedEmployee.mobile || "No mobile"} · Change
                </button>
              )}
            </label>
          </div>
          <div className="uniform-entry-grid">
            {UNIFORM_ITEMS.map((item) => (
              <div className="uniform-entry-fields" key={item}>
                <label className="uniform-item-check">
                  <input
                    type="checkbox"
                    checked={draft[item].selected}
                    onChange={(event) => updateDraft(item, { selected: event.target.checked })}
                  />
                  <span>{UNIFORM_ITEM_LABELS[item]}</span>
                </label>
                <label className="field">
                  <span>Amount (INR)</span>
                  <input
                    type="number"
                    min="0"
                    max="10000000"
                    step="0.01"
                    inputMode="decimal"
                    value={draft[item].amount}
                    onChange={(event) => updateDraft(item, { amount: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Deduction month</span>
                  <input
                    type="month"
                    value={draft[item].deductionMonth}
                    onChange={(event) => updateDraft(item, { deductionMonth: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Remark</span>
                  <input
                    maxLength={500}
                    value={draft[item].remark}
                    onChange={(event) => updateDraft(item, { remark: event.target.value })}
                  />
                </label>
              </div>
            ))}
          </div>
          <div className="uniform-total-row">
            <strong>Total uniform deduction</strong>
            <strong>{currency(totalAmount)}</strong>
            <button
              type="submit"
              className="button button-primary"
              disabled={saving || !employeeId || !UNIFORM_ITEMS.some(
                (item) => draft[item].selected || draft[item].amount.trim(),
              )}
            >
              {saving ? <LoaderCircle className="spin" size={16} /> : null}
              Save deductions
            </button>
          </div>
        </form>
      </section>

      <section className="panel uniform-report-panel">
        <div className="panel-heading">
          <div>
            <h2>Uniform deduction report</h2>
            <p>{total} record(s) · itemized by employee and deduction month.</p>
          </div>
        </div>
        <div className="uniform-filters">
          <label className="field">
            <span>Outlet</span>
            <select
              value={reportOutletId}
              onChange={(event) => {
                setPage(1);
                setReportOutletId(event.target.value);
                setReportEmployeeId("");
              }}
            >
              <option value="">All accessible outlets</option>
              {(outlets ?? []).map((outlet) => (
                <option key={outlet._id} value={outlet._id}>
                  {outlet.code} · {outlet.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Search employee</span>
            <input
              value={reportEmployeeQuery}
              onChange={(event) => {
                setReportEmployeeQuery(event.target.value);
                setReportEmployeeId("");
              }}
              placeholder="Name, ID, or mobile"
            />
          </label>
          <label className="field">
            <span>Employee</span>
            <select
              value={reportEmployeeId}
              onChange={(event) => {
                setPage(1);
                setReportEmployeeId(event.target.value);
              }}
            >
              <option value="">All employees</option>
              {reportEmployees.map((employee) => (
                <option key={employee._id} value={employee._id}>
                  {employee.fullName} · {employee.employeeCode}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Month</span>
            <input
              type="month"
              value={monthFilter}
              onChange={(event) => {
                setPage(1);
                setMonthFilter(event.target.value);
              }}
            />
          </label>
          <label className="field">
            <span>Item</span>
            <select value={itemFilter} onChange={(event) => { setPage(1); setItemFilter(event.target.value); }}>
              <option value="ALL">All items</option>
              {UNIFORM_ITEMS.map((item) => <option key={item} value={item}>{UNIFORM_ITEM_LABELS[item]}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => { setPage(1); setStatusFilter(event.target.value); }}>
              <option value="ALL">All statuses</option>
              <option value="SCHEDULED">Scheduled</option>
              <option value="APPLIED">Applied</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </label>
        </div>
        <div className="table-scroll uniform-table-scroll">
          <table className="data-table uniform-data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Outlet</th>
                <th>Item</th>
                <th>Amount</th>
                <th>Deduction month</th>
                <th>Status</th>
                <th>Remark</th>
                <th className="uniform-action-column">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="uniform-empty-state"><LoaderCircle className="spin" size={18} /> Loading deductions…</td></tr>
              ) : displayedRows.length ? displayedRows.map((row) => (
                <tr key={row._id}>
                  <td>
                    <strong>{row.employeeName}</strong>
                    <span className="sub-cell">{row.employeeCode} · {row.mobile || "No mobile"}</span>
                  </td>
                  <td>{row.outletCode || "—"}</td>
                  <td>{UNIFORM_ITEM_LABELS[row.item]}</td>
                  <td>{currency(row.amount)}</td>
                  <td>{row.deductionMonth}</td>
                  <td><span className={`badge ${row.status === "APPLIED" ? "badge-green" : row.status === "SCHEDULED" ? "badge-gold" : "badge-muted"}`}>{row.status}</span></td>
                  <td>{row.remark || "—"}</td>
                  <td className="uniform-action-column">
                    {row.status === "SCHEDULED" && (
                      <details className="uniform-row-actions">
                        <summary>Edit</summary>
                        <form onSubmit={(event) => void updateDeduction(row._id, event)}>
                          <label className="field"><span>Amount (INR)</span><input name="amount" type="number" min="0" max="10000000" step="0.01" defaultValue={row.amount} /></label>
                          <label className="field"><span>Deduction month</span><input name="deductionMonth" type="month" defaultValue={row.deductionMonth} /></label>
                          <label className="field"><span>Remark</span><input name="remark" maxLength={500} defaultValue={row.remark ?? ""} /></label>
                          <button type="submit" className="button button-primary button-small">Save</button>
                          <button type="button" className="button button-small" onClick={() => void mutate(`/api/uniform-deductions/${row._id}`, "PATCH", { status: "CANCELLED" })}>Cancel deduction</button>
                        </form>
                      </details>
                    )}
                    {row.status !== "APPLIED" && (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Delete ${UNIFORM_ITEM_LABELS[row.item]} deduction for ${row.employeeName}`}
                        onClick={() => {
                          if (window.confirm("Delete this uniform deduction?"))
                            void mutate(`/api/uniform-deductions/${row._id}`, "DELETE");
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={8} className="uniform-empty-state">No uniform deductions match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="uniform-pagination">
          <span>Page {Math.min(page, pageCount)} of {pageCount}</span>
          <div>
            <button className="button button-small" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Previous</button>
            <button className="button button-small" disabled={page >= pageCount || loading} onClick={() => setPage((current) => current + 1)}>Next</button>
          </div>
        </div>
      </section>
    </main>
  );
}
