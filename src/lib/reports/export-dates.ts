const isoDatePattern =
  /\b(\d{4})-(\d{2})-(\d{2})(T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g;

function formatDateParts(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).formatToParts(value);
  const fields = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${fields.day}/${fields.month}/${fields.year}`;
}

function formatTimestamp(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Kolkata",
  }).formatToParts(value);
  const fields = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${fields.day}/${fields.month}/${fields.year}, ${fields.hour}:${fields.minute}`;
}

export function formatExportDates(value: string): string {
  return value.replace(
    isoDatePattern,
    (match, year: string, month: string, day: string, timestamp?: string) => {
      const date = new Date(
        Date.UTC(Number(year), Number(month) - 1, Number(day)),
      );
      if (
        date.getUTCFullYear() !== Number(year) ||
        date.getUTCMonth() !== Number(month) - 1 ||
        date.getUTCDate() !== Number(day)
      )
        return match;

      if (timestamp) {
        const parsed = new Date(match);
        return Number.isNaN(parsed.valueOf())
          ? match
          : formatTimestamp(parsed);
      }
      return formatDateParts(date);
    },
  );
}
