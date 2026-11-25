import type { OutletDocument } from "@/lib/models";

export type OutletSettingsDocument = OutletDocument & {
  weekly_off_count?: number;
  sort_order?: number;
  draft_sort_order?: number;
};
