"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { WorkspaceData } from "@/lib/ui-types";

export type DashboardPart =
  | "attendance"
  | "trend"
  | "away"
  | "outlets";

type DashboardPartFilters = {
  date: string;
  from: string;
  to: string;
  outletId: string;
  awayFrom?: string;
  awayTo?: string;
  refreshKey?: number;
};

export function DashboardPartLoader({
  part,
  filters,
  children,
}: {
  part: DashboardPart;
  filters: DashboardPartFilters;
  children: (data: WorkspaceData) => ReactNode;
}) {
  const params = new URLSearchParams({
    parts: part,
    date: filters.date,
    from: filters.from,
    to: filters.to,
  });
  if (filters.outletId) params.set("outletId", filters.outletId);
  if (filters.awayFrom) params.set("awayFrom", filters.awayFrom);
  if (filters.awayTo) params.set("awayTo", filters.awayTo);
  if (filters.refreshKey !== undefined)
    params.set("refreshKey", String(filters.refreshKey));
  const url = `/api/dashboard?${params.toString()}`;
  const [result, setResult] = useState<{
    url: string;
    data?: WorkspaceData;
    error?: string;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as WorkspaceData & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(data.error || "Unable to load dashboard section.");
        setResult({ url, data });
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          url,
          error:
            caught instanceof Error
              ? caught.message
              : "Unable to load dashboard section.",
        });
      });
    return () => controller.abort();
  }, [url]);

  const currentResult = result?.url === url ? result : null;
  if (!currentResult)
    return (
      <div className="loading-state" role="status">
        Loading records
      </div>
    );
  if (currentResult.error)
    return (
      <div className="notice notice-error" role="alert">
        {currentResult.error}
      </div>
    );
  return children(currentResult.data ?? {});
}
