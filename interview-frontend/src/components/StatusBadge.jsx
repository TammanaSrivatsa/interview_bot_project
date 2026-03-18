import React from "react";
import { cn } from "../utils/utils";

const statusStyles = {
  analyzed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800",
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  completed: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-800",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800",
  shortlisted: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
  selected: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
  applied: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700",
  interview_scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  not_started: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700",
};

export default function StatusBadge({ status, className }) {
  const normalized =
    status && typeof status === "object"
      ? {
          key: String(status.key || status.label || "unknown").trim().toLowerCase().replace(/\s+/g, "_"),
          label: status.label || status.key || "Unknown",
          tone: status.tone || "secondary",
        }
      : {
          key: String(status || "unknown").trim().toLowerCase().replace(/\s+/g, "_"),
          label: status || "Unknown",
          tone: "secondary",
        };

  const toneStyles = {
    success: statusStyles.shortlisted,
    danger: statusStyles.rejected,
    primary: statusStyles.scheduled,
    secondary: statusStyles.applied,
    dark: statusStyles.completed,
  };

  const style =
    statusStyles[normalized.key] ||
    toneStyles[normalized.tone] ||
    "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700";

  return (
    <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-medium border", style, className)}>
      {normalized.label}
    </span>
  );
}
