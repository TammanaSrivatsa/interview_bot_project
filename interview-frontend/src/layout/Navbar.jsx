import React from "react";
import { Bell, Search, Sun, Moon, Menu } from "lucide-react";

export default function Navbar({ toggleSidebar }) {
  const [isDark, setIsDark] = React.useState(false);

  const toggleTheme = () => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.remove("dark");
    } else {
      root.classList.add("dark");
    }
    setIsDark(!isDark);
  };

  return (
    <header className="h-16 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-8 sticky top-0 z-40">
      <div className="flex items-center space-x-4">
        <button onClick={toggleSidebar} className="p-2 lg:hidden text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">
          <Menu size={20} />
        </button>
        <div className="hidden md:flex items-center bg-slate-100 dark:bg-slate-800 px-4 py-2 rounded-xl w-80">
          <Search size={18} className="text-slate-400" />
          <input
            type="text"
            placeholder="Search for candidates..."
            className="bg-transparent border-none focus:ring-0 text-sm ml-2 w-full text-slate-900 dark:text-white"
          />
        </div>
      </div>

      <div className="flex items-center space-x-3">
        <button
          onClick={toggleTheme}
          className="p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 rounded-lg transition-all"
        >
          {isDark ? <Sun size={20} /> : <Moon size={20} />}
        </button>
        <button className="p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 rounded-lg relative transition-all">
          <Bell size={20} />
          <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white dark:border-slate-900"></span>
        </button>
        <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-2 hidden sm:block"></div>
        <div className="flex items-center space-x-3 ml-2">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold text-slate-900 dark:text-white leading-none">Admin Panel</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Free Trial</p>
          </div>
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold ring-2 ring-white dark:ring-slate-800">
            A
          </div>
        </div>
      </div>
    </header>
  );
}
