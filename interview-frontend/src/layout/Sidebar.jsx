import React from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, Users, ClipboardList, Settings, LogOut,
  MessageSquare, BarChart3, Video, FileText, LayoutGrid, Download
} from "lucide-react";
import { useAuth } from "../context/useAuth";
import { cn } from "../utils/utils";

// PHASE 1 FIX: Removed redundant "Skill Weights" link — that functionality
// is now fully handled inside JD Management (edit JD → update weights).
export default function Sidebar() {
  const { user, logout } = useAuth();
  const isHR = user?.role === "hr";

  const hrLinks = [
    { name: "Dashboard",         path: "/hr",              icon: LayoutDashboard },
    { name: "Candidates",        path: "/hr/candidates",   icon: Users },
    { name: "JD Management",     path: "/hr/jds",          icon: FileText },
    { name: "Score Matrix",      path: "/hr/matrix",       icon: LayoutGrid },
    { name: "Interview Reviews", path: "/hr/interviews",   icon: ClipboardList },
    { name: "Analytics",         path: "/hr/analytics",    icon: BarChart3 },
    { name: "Backup",            path: "/hr/backup",       icon: Download },
    { name: "Settings",          path: "/settings",        icon: Settings },
  ];

  const candidateLinks = [
    { name: "Dashboard", path: "/candidate", icon: LayoutDashboard },
    { name: "Practice",  path: "/candidate/practice", icon: MessageSquare },
    { name: "Settings",  path: "/settings", icon: Settings },
  ];

  const links = isHR ? hrLinks : candidateLinks;

  return (
    <aside className="w-64 h-screen bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col fixed left-0 top-0 z-50">
      <div className="p-6">
        <div className="flex items-center space-x-2">
          <div className="bg-blue-600 p-1.5 rounded-lg">
            <Video className="text-white w-5 h-5" />
          </div>
          <span className="text-xl font-bold font-display tracking-tight dark:text-white">
            Interview<span className="text-blue-600">Bot</span>
          </span>
        </div>
      </div>
      <nav className="flex-1 px-4 space-y-1 overflow-y-auto mt-2">
        {links.map((link) => (
          <NavLink
            key={link.path}
            to={link.path}
            end={link.path === "/hr" || link.path === "/candidate"}
            className={({ isActive }) =>
              cn(
                "flex items-center space-x-3 px-4 py-2.5 rounded-xl transition-all font-medium text-sm",
                isActive
                  ? "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
                  : "text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/50"
              )
            }
          >
            <link.icon size={18} />
            <span>{link.name}</span>
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t border-slate-100 dark:border-slate-800">
        <div className="flex items-center p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 mb-3">
          <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold mr-3">
            {user?.name?.[0] || "U"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{user?.name || "User"}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 capitalize">{user?.role || "Role"}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="flex items-center space-x-3 px-4 py-2.5 rounded-xl w-full text-slate-500 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-900/20 transition-all font-medium text-sm"
        >
          <LogOut size={18} />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}
