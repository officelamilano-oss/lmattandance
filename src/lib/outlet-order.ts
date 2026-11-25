export function moveOutletOrder(
  outletIds: readonly string[],
  index: number,
  direction: -1 | 1,
) {
  const nextIndex = index + direction;
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= outletIds.length ||
    nextIndex < 0 ||
    nextIndex >= outletIds.length
  )
    return [...outletIds];
  const next = [...outletIds];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}
