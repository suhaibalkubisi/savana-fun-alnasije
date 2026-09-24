// Synthetic identities and times only: same dimensions/token counts as the
// device export, never copied employee data. Future dates remain blank.
export function monthlyDeviceRows() {
  const populated = new Map(Array.from({ length: 4318 }, (_, i) => [Math.floor(i * (215 * 23) / 4318), i]));
  return [
    ["Person Code", "Name", ...Array.from({ length: 30 }, (_, i) => `09-${String(i + 1).padStart(2, "0")}`)],
    ...Array.from({ length: 215 }, (_, employee) => [
      `SYN-${String(employee + 1).padStart(4, "0")}`, `موظف تجريبي ${employee + 1}`,
      ...Array.from({ length: 30 }, (_, day) => {
        const i = populated.get(day * 215 + employee);
        return i === undefined ? "" : i < 152 ? "01:18\n16:05\n20:15" : i < 2946 ? "01:18\n16:05" : "16:05";
      }),
    ]),
  ];
}
