import { useEffect, useState } from "react";
import type {
  EmployeeAttendanceReport,
  EmployeeAttendanceReportRow,
} from "@/lib/ui-types";

type EmployeeAttendanceReportFilters = {
  enabled: boolean;
  from: string;
  to: string;
  outletId: string;
  employeeId: string;
};

export function useEmployeeAttendanceReport({
  enabled,
  from,
  to,
  outletId,
  employeeId,
}: EmployeeAttendanceReportFilters) {
  const [rows, setRows] = useState<EmployeeAttendanceReportRow[]>([]);
  const [employees, setEmployees] =
    useState<EmployeeAttendanceReport["employees"]>([]);
  const [canReadSalary, setCanReadSalary] = useState(false);
  const [settledKey, setSettledKey] = useState("");
  const [requestError, setRequestError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const key = `${from}|${to}|${outletId}|${employeeId}`;
  const validationError =
    enabled && from && to && from > to
      ? "Start date must be on or before end date."
      : "";

  useEffect(() => {
    if (!enabled || !from || !to || from > to) return;

    const controller = new AbortController();
    const params = new URLSearchParams({ from, to });
    if (outletId) params.set("outletId", outletId);
    if (employeeId) params.set("employeeId", employeeId);

    const timeout = window.setTimeout(() => {
      setRequestError(null);
      void fetch(`/api/reports/employee-attendance?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const result = (await response.json()) as EmployeeAttendanceReport & {
            error?: string;
          };
          if (!response.ok)
            throw new Error(result.error || "Unable to load attendance report.");
          setRows(result.rows);
          setEmployees(result.employees);
          setCanReadSalary(result.canReadSalary);
          setSettledKey(key);
        })
        .catch((caught: unknown) => {
          if (controller.signal.aborted) return;
          setRequestError({
            key,
            message:
              caught instanceof Error
                ? caught.message
                : "Unable to load attendance report.",
          });
          setSettledKey(key);
        });
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [enabled, from, to, outletId, employeeId, key]);

  return {
    rows,
    employees,
    canReadSalary,
    isFetching:
      enabled && !validationError && Boolean(from && to) && settledKey !== key,
    error: validationError || (requestError?.key === key ? requestError.message : ""),
  };
}
