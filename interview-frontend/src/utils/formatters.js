export function screeningBandLabel(band) {
  if (band === "strong_shortlist") return "Strong Shortlist";
  if (band === "review_shortlist") return "Review Shortlist";
  if (band === "reject") return "Reject";
  return "Not evaluated";
}

export function formatPercent(value, fallback = "N/A") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return fallback;
  }
  return `${Number(value).toFixed(2)}%`;
}

export function formatScoreValue(value, fallback = "0.00") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return fallback;
  }
  return Number(value).toFixed(2);
}

export function formatDateTime(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

export function titleCase(value) {
  return String(value || "")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}
