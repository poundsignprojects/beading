// Pure fractional-order calculation for drag-reorder (Phase 4 plan's "Design
// ordering uses fractional sort keys" decision) — a drop only ever writes the one
// moved record, never renumbers the whole list.

export function orderForInsertAt(sortedList, targetIndex) {
  if (sortedList.length === 0) return 0;
  if (targetIndex <= 0) return sortedList[0].order - 1;
  if (targetIndex >= sortedList.length) return sortedList[sortedList.length - 1].order + 1;
  return (sortedList[targetIndex - 1].order + sortedList[targetIndex].order) / 2;
}
