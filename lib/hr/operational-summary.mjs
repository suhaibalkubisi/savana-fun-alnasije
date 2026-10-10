/** Daily task totals share the final HR status supplied by the database. */
export function operationalSummary(rows) {
  return rows.reduce(
    (counts, row) => {
      if (row.expected) counts.expected++;
      if (row.status === "present") counts.present++;
      if (row.status === "late") {
        counts.late++;
        counts.lateMinutes += Number(row.late_minutes) || 0;
      }
      if (["absence", "absence2", "absence3"].includes(row.status))
        counts.absence++;
      if (row.status === "leave") counts.leave++;
      if (row.status === "no_entry" && row.expected) counts.noEntry++;
      if (row.needs_review) counts.review++;
      return counts;
    },
    {
      expected: 0,
      present: 0,
      late: 0,
      lateMinutes: 0,
      absence: 0,
      leave: 0,
      noEntry: 0,
      review: 0,
    },
  );
}

export function effectiveDepartmentRule(rules, departmentId, date) {
  return (
    rules
      .filter(
        (rule) =>
          rule.department_id === departmentId && rule.effective_from <= date,
      )
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ||
    null
  );
}
