import type { DashboardOutlet } from "@/lib/ui-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOutlet(value: unknown): value is DashboardOutlet {
  return (
    isRecord(value) &&
    typeof value._id === "string" &&
    typeof value.code === "string" &&
    typeof value.name === "string" &&
    typeof value.active === "boolean"
  );
}

export function normalizeOutlets(data: unknown): DashboardOutlet[] {
  const list = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.outlets)
      ? data.outlets
      : isRecord(data) && Array.isArray(data.data)
        ? data.data
        : [];
  const seenIds = new Set<string>();
  return list.filter((value): value is DashboardOutlet => {
    if (!isOutlet(value) || seenIds.has(value._id)) return false;
    seenIds.add(value._id);
    return true;
  });
}

export async function fetchOutletList(): Promise<DashboardOutlet[]> {
  const response = await fetch("/api/outlets", { cache: "no-store" });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      isRecord(body) && typeof body.error === "string"
        ? body.error
        : `Unable to load outlets (HTTP ${response.status}).`;
    throw new Error(message);
  }
  return normalizeOutlets(await response.json());
}
