import { z } from "zod";
import { monthSchema } from "@/lib/validation/common";
import type { UniformItemKey } from "@/lib/models";

export const UNIFORM_ITEMS = [
  "shirt",
  "pant",
  "shoes",
  "cap",
  "costume",
] as const satisfies readonly UniformItemKey[];

export const UNIFORM_ITEM_LABELS: Record<UniformItemKey, string> = {
  shirt: "Shirt",
  pant: "Pant",
  shoes: "Shoes",
  cap: "Cap",
  costume: "Costume",
};

export type UniformReportItem = { key: string; label: string };

export function getUniformReportItems(
  configuredItems: UniformReportItem[],
  usedItems: string[] = [],
): UniformReportItem[] {
  const labels = new Map<string, string>(Object.entries(UNIFORM_ITEM_LABELS));
  for (const item of configuredItems) labels.set(item.key, item.label);
  const keys = configuredItems.length
    ? configuredItems.map((item) => item.key)
    : [...UNIFORM_ITEMS];
  for (const item of usedItems) {
    if (!keys.includes(item)) keys.push(item);
  }
  return [...new Set(keys)].map((key) => ({
    key,
    label:
      labels.get(key) ??
      key
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase()),
  }));
}

export function summarizeUniformDeductions(
  entries: Array<{
    item: string;
    amount: number;
    deductionMonth: string;
    status: "SCHEDULED" | "APPLIED" | "CANCELLED";
  }>,
  fromMonth: string,
  toMonth: string,
) {
  const itemCents = new Map<string, number>();
  let totalCents = 0;
  let remainingCents = 0;
  for (const entry of entries) {
    if (entry.status === "CANCELLED") continue;
    const cents = Math.round(entry.amount * 100);
    if (entry.deductionMonth >= fromMonth && entry.deductionMonth <= toMonth) {
      itemCents.set(entry.item, (itemCents.get(entry.item) ?? 0) + cents);
      totalCents += cents;
    } else if (
      entry.deductionMonth > toMonth &&
      entry.status === "SCHEDULED"
    ) {
      remainingCents += cents;
    }
  }
  return {
    byItem: Object.fromEntries(
      [...itemCents].map(([item, cents]) => [item, cents / 100]),
    ) as Record<string, number>,
    total: totalCents / 100,
    remaining: remainingCents / 100,
  };
}

const optionalMonthSchema = z.preprocess(
  (value) => (typeof value === "string" && !value.trim() ? undefined : value),
  monthSchema.optional(),
);

export const uniformEntrySchema = z.object({
  item: z.enum(UNIFORM_ITEMS),
  selected: z.boolean().optional().default(false),
  amount: z
    .preprocess(
      (value) =>
        typeof value === "string"
          ? value.trim()
            ? Number(value)
            : undefined
          : value,
      z.number().finite().nonnegative().max(10_000_000).optional(),
    ),
  deductionMonth: optionalMonthSchema,
  remark: z.string().trim().max(500).optional().default(""),
});

export const uniformEntriesSchema = z.array(uniformEntrySchema).max(50);

export type NormalizedUniformEntry = {
  item: UniformItemKey;
  amount: number;
  deductionMonth: string;
  remark: string;
};

export function normalizeUniformEntries(
  entries: z.infer<typeof uniformEntriesSchema>,
  currentMonth: string,
): NormalizedUniformEntry[] {
  return entries
    .filter((entry) => entry.selected || entry.amount !== undefined)
    .map((entry) => ({
      item: entry.item,
      amount: entry.amount ?? 0,
      deductionMonth: entry.deductionMonth ?? currentMonth,
      remark: entry.remark,
    }));
}

export function sumUniformDeductions(
  entries: Array<{ amount: number }>,
): number {
  return entries.reduce((sum, entry) => sum + entry.amount, 0);
}

export function hasPastUniformMonth(
  entries: Array<{ deductionMonth: string }>,
  currentMonth: string,
) {
  return entries.some((entry) => entry.deductionMonth < currentMonth);
}

export function uniformEntriesFromForm(formData: FormData) {
  return UNIFORM_ITEMS.flatMap((item) => {
    const rawAmount = String(formData.get(`uniform-${item}-amount`) ?? "").trim();
    const selected = formData.get(`uniform-${item}-selected`) === "on";
    if (!selected && !rawAmount) return [];
    return [{
      item,
      selected,
      ...(rawAmount ? { amount: Number(rawAmount) } : {}),
      deductionMonth: String(formData.get(`uniform-${item}-month`) ?? ""),
      remark: String(formData.get(`uniform-${item}-remark`) ?? ""),
    }];
  });
}
