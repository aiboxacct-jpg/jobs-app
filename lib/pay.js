// Pay parsing for free-text salary strings ("$24.85–$33.96/hr",
// "$75,000–$86,000/yr + bonus", "From $80,000/yr", "Salary not listed", …).
// Everything reduces to an hourly-equivalent number for sorting, and a
// coarse Hourly / Yearly / None type for filtering.

export function parseAmounts(salary) {
  if (!salary) return [];
  const matches = String(salary).match(/\$?\s*\d[\d,]*(?:\.\d+)?/g) || [];
  return matches
    .map((m) => parseFloat(m.replace(/[$,\s]/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function payUnit(salary) {
  const s = String(salary || "").toLowerCase();
  if (/\/(hr|hour)\b|per hour|hourly/.test(s)) return "hour";
  if (/\/(mo|month)\b|per month|monthly/.test(s)) return "month";
  if (/\/(yr|year)\b|per year|annual|salary/.test(s) && parseAmounts(s).length)
    return "year";
  return null;
}

/** Hourly-equivalent pay, or null when the text carries no usable figure. */
export function hourlyEquivalent(salary) {
  const amounts = parseAmounts(salary);
  if (!amounts.length) return null;
  // For a range, use the midpoint; for a single figure, the figure itself.
  const base =
    amounts.length >= 2
      ? (amounts[0] + amounts[1]) / 2
      : amounts[0];
  const unit = payUnit(salary);
  if (unit === "hour") return base;
  if (unit === "month") return (base * 12) / 2080;
  if (unit === "year") return base / 2080;
  // No explicit unit: large numbers read as annual salaries, small as hourly.
  return base >= 1000 ? base / 2080 : base;
}

/** Filter bucket: "Hourly" | "Yearly" | "None". */
export function payType(salary) {
  const amounts = parseAmounts(salary);
  if (!amounts.length) return "None";
  const unit = payUnit(salary);
  if (unit === "hour") return "Hourly";
  if (unit === "year" || unit === "month") return "Yearly";
  return amounts[0] >= 1000 ? "Yearly" : "Hourly";
}
