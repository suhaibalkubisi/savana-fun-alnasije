const arabicDigits = (value) =>
  String(value).replace(/\d/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]);

/** Display only: stored punch minutes and work-date calculations stay unchanged. */
export function formatClock12(value) {
  if (
    value === null ||
    value === undefined ||
    !Number.isInteger(value) ||
    value < 0
  )
    return "—";
  const minuteOfDay = value % 1440;
  const hour = Math.floor(minuteOfDay / 60);
  const clock = `${arabicDigits(String(hour % 12 || 12).padStart(2, "0"))}:${arabicDigits(String(minuteOfDay % 60).padStart(2, "0"))} ${hour < 12 ? "ص" : "م"}`;
  const days = Math.floor(value / 1440);
  return days ? `${clock} (+${arabicDigits(days)} يوم)` : clock;
}

export function clock12Parts(value) {
  const minutes = Number.isInteger(value) && value >= 0 ? value % 1440 : 0;
  const hours = Math.floor(minutes / 60);
  return {
    hour: hours % 12 || 12,
    minute: minutes % 60,
    period: hours < 12 ? "AM" : "PM",
  };
}

export function minutesFromClock12(hour, minute, period) {
  if (
    !Number.isInteger(hour) ||
    hour < 1 ||
    hour > 12 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59 ||
    !["AM", "PM"].includes(period)
  )
    throw new RangeError("وقت غير صالح");
  return ((hour % 12) + (period === "PM" ? 12 : 0)) * 60 + minute;
}
