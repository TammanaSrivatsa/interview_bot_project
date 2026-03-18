import React from "react";
import { TrendingDown, TrendingUp } from "lucide-react";

export default function MetricCard({
  title,
  label,
  value,
  hint,
  icon: Icon,
  trend,
  trendValue,
  color = "blue",
}) {
  const heading = title ?? label ?? "";
  const colorClasses = {
    blue: "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400",
    green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400",
    red: "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400",
    purple: "bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400",
    yellow: "bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400",
  };

  return (
    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-all hover:shadow-md">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{heading}</p>
          <h3 className="text-2xl font-bold mt-1 text-slate-900 dark:text-white">{value}</h3>

          {trend && (
            <div className="flex items-center mt-2">
              {trend === "up" ? (
                <TrendingUp className="w-4 h-4 text-emerald-500 mr-1" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-500 mr-1" />
              )}
              <span className={`text-xs font-medium ${trend === "up" ? "text-emerald-500" : "text-red-500"}`}>
                {trendValue}
              </span>
              <span className="text-xs text-slate-400 ml-1.5">vs last month</span>
            </div>
          )}

          {!trend && hint ? (
            <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">{hint}</p>
          ) : null}
        </div>
        <div className={`p-3 rounded-lg ${colorClasses[color]}`}>
          {Icon && <Icon size={24} />}
        </div>
      </div>
    </div>
  );
}
