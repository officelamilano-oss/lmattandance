"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { Activity, ArrowRight, Banknote, Bell, BookOpen, Building2, CalendarDays, ClipboardList, FileSpreadsheet, LayoutDashboard, LogOut, Menu, Moon, Settings2, ShieldCheck, Sun, Users, Wallet, X, HandCoins } from "lucide-react";
import type { Permission, UserRole } from "@/lib/models";
import type { AdvanceView, WorkspaceData } from "@/lib/ui-types";

type AppNotification = {
  id: string;
  title: string;
  detail: string;
  href: string;
  action: string;
  icon: "attendance" | "advance" | "employee";
  advance?: AdvanceView;
};

const navigation: Array<{ href: string; label: string; icon: typeof LayoutDashboard; permission: Permission; mainAdminOnly?: boolean; always?: boolean }> = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard.read" },
  { href: "/attendance", label: "Attendance", icon: CalendarDays, permission: "attendance.read" },
  { href: "/salary", label: "Monthly salary", icon: Banknote, permission: "salary.read" },
  { href: "/employees", label: "Employees", icon: Users, permission: "employees.read" },
  { href: "/advances", label: "Advances", icon: Wallet, permission: "advances.read" },
  { href: "/loans", label: "Loans", icon: HandCoins, permission: "salary.read", mainAdminOnly: true },
  { href: "/outlets", label: "Outlets", icon: Building2, permission: "outlets.manage" },
  { href: "/access", label: "Access mana  gement", icon: ShieldCheck, permission: "access.manage" },
  { href: "/reports", label: "Reports & exports", icon: FileSpreadsheet, permission: "reports.export" },
  { href: "/active-logs", label: "Active logs", icon: ClipboardList, permission: "audit.read" },
  { href: "/settings", label: "Settings", icon: Settings2, permission: "settings.manage" },
  { href: "/about", label: "About Us", icon: BookOpen, permission: "dashboard.read", always: true },
];

export function AppShell({ children, user }: { children: React.ReactNode; user: { name: string; email: string; role: UserRole; permissions: Permission[] } }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [dismissedNotifications, setDismissedNotifications] = useState<string[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const canReadDashboard = user.permissions.includes("dashboard.read");
  const canReadAdvances = user.permissions.includes("advances.read");
  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
  }, [darkMode]);
  const loadNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    setNotificationError("");
    try {
      const [dashboardResponse, advancesResponse] = await Promise.all([
        canReadDashboard
          ? fetch("/api/dashboard?parts=summary,notifications", { cache: "no-store" })
          : Promise.resolve(null),
        canReadAdvances
          ? fetch("/api/advances?status=PENDING&pageSize=100", {
              cache: "no-store",
            })
          : Promise.resolve(null),
      ]);
      const nextNotifications: AppNotification[] = [];
      const errors: string[] = [];

      if (dashboardResponse) {
        const dashboard = (await dashboardResponse.json()) as WorkspaceData & {
          error?: string;
        };
        if (!dashboardResponse.ok) {
          errors.push(dashboard.error || "Unable to load attendance notifications.");
        } else {
          const today = dashboard.today ?? new Date().toISOString().slice(0, 10);
          const missingSubmissions = dashboard.metrics?.missingSubmissions ?? 0;
          if (missingSubmissions > 0) {
            nextNotifications.push({
              id: `missing-attendance:${today}`,
              title: `${missingSubmissions} outlet${missingSubmissions === 1 ? " has" : "s have"} not submitted attendance today`,
              detail: "Attendance submissions are still outstanding.",
              href: "/attendance",
              action: "Open attendance",
              icon: "attendance",
            });
          }
          for (const employee of dashboard.dashboardNotifications ?? []) {
            if (employee.status !== "A") continue;
            nextNotifications.push({
              id: `absent:${today}:${employee.employeeId}`,
              title: `${employee.employeeName} was marked absent today`,
              detail: `${employee.employeeCode}${employee.outletCode ? ` · ${employee.outletCode}` : ""}`,
              href: `/employees/${employee.employeeId}`,
              action: "View employee",
              icon: "employee",
            });
          }
        }
      }

      if (advancesResponse) {
        const advances = (await advancesResponse.json()) as {
          advances?: AdvanceView[];
          error?: string;
        };
        if (!advancesResponse.ok) {
          errors.push(advances.error || "Unable to load pending advance requests.");
        } else {
          for (const advance of advances.advances ?? []) {
            nextNotifications.push({
              id: `advance:${advance._id}`,
              title: "Advance request awaiting approval",
              detail: advance.employeeName || "Unknown employee",
              href: "/advances",
              action: "Open request",
              icon: "advance",
              advance,
            });
          }
        }
      }

      const storageKey = `dismissed-notifications:v2:${user.email}`;
      const dismissed = JSON.parse(
        window.localStorage.getItem(storageKey) ?? "[]",
      ) as string[];
      setDismissedNotifications(dismissed);
      setNotifications(nextNotifications);
      setNotificationError(errors.join(" "));
    } catch (caught) {
      setNotificationError(
        caught instanceof Error
          ? caught.message
          : "Unable to load notifications.",
      );
    } finally {
      setNotificationsLoading(false);
    }
  }, [canReadAdvances, canReadDashboard, user.email]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadNotifications();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadNotifications]);

  function dismissNotification(id: string) {
    const storageKey = `dismissed-notifications:v2:${user.email}`;
    const dismissed = new Set(dismissedNotifications);
    dismissed.add(id);
    const next = [...dismissed];
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    setDismissedNotifications(next);
  }
  const items = navigation.filter((item) => item.always || user.role === "MAIN_ADMIN" || (!item.mainAdminOnly && user.permissions.includes(item.permission)));
  return (
    <div className="app-frame">
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand-lockup"><Image className="brand-logo" src="/logo.png" alt="LA MILANO Pizzeria logo" width={768} height={785} /><div><strong>LA MILANO</strong><span>AMS powered by Roshan</span></div></div>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="nav-list" aria-label="Main navigation">
          {items.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === href : pathname.startsWith(href);
            return <Link key={href} href={href} onClick={() => setOpen(false)} className={`nav-link ${active ? "nav-active" : ""}`}><Icon size={18} strokeWidth={1.8} /><span>{label}</span>{active && <i />}</Link>;
          })}
        </nav>
        <div className="sidebar-bottom"><div className="system-status"><span className="status-dot" /> Workspace secured</div><div className="user-block"><div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div><div className="user-info"><strong>{user.name}</strong><span>{user.role.replaceAll("_", " ")}</span></div><button className="icon-button logout-button" title="Sign out" aria-label="Sign out" onClick={() => signOut({ callbackUrl: "/login" })}><LogOut size={17} /></button></div></div>
      </aside>
      {open && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setOpen(false)} />}
      <main className="main-column" data-page={pathname === "/" ? "dashboard" : pathname.split("/")[1] ?? "dashboard"}><header className="topbar"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setOpen(!open)}>{open ? <X size={20} /> : <Menu size={20} />}</button><div className="breadcrumb"><Activity size={15} /><span>Operations</span><b>/</b><strong>{navigation.find((item) => item.href === pathname)?.label ?? "Workspace"}</strong></div><div className="topbar-right"><span className="topbar-date">AMS powered by Roshan</span>{(user.permissions.includes("dashboard.read") || user.permissions.includes("advances.read")) && <button className="topbar-utility notification-trigger" type="button" aria-label="Open notifications" title="Notifications" onClick={() => { setNotificationsOpen(true); void loadNotifications(); }}><Bell size={15} />{notifications.filter((item) => !dismissedNotifications.includes(item.id)).length > 0 && <span className="notification-count">{notifications.filter((item) => !dismissedNotifications.includes(item.id)).length > 99 ? "99+" : notifications.filter((item) => !dismissedNotifications.includes(item.id)).length}</span>}</button>}<button className="topbar-utility" type="button" aria-label={darkMode ? "Switch to light theme" : "Switch to dark theme"} title={darkMode ? "Switch to light theme" : "Switch to dark theme"} onClick={() => setDarkMode((current) => !current)}>{darkMode ? <Sun size={15} /> : <Moon size={15} />}</button><details className="profile-menu"><summary className="topbar-avatar" aria-label="Open profile menu">{user.name.slice(0, 1).toUpperCase()}</summary><div className="profile-menu-content"><strong>{user.name}</strong><span>{user.email}</span><small>{user.role.replaceAll("_", " ")}</small><button type="button" onClick={() => signOut({ callbackUrl: "/login" })}><LogOut size={14} /> Sign out</button></div></details></div></header>{children}</main>
      {notificationsOpen && (
        <div className="notification-drawer-backdrop">
          <button
            className="notification-drawer-scrim"
            type="button"
            aria-label="Close notifications"
            onClick={() => setNotificationsOpen(false)}
          />
          <aside
            className="notification-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="notification-drawer-title"
          >
            <header className="notification-drawer-header">
              <div>
                <h2 id="notification-drawer-title">Notifications</h2>
                <p>
                  {notifications.filter((item) => !dismissedNotifications.includes(item.id)).length} outstanding notification{notifications.filter((item) => !dismissedNotifications.includes(item.id)).length === 1 ? "" : "s"}
                </p>
              </div>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => {
                  setNotificationsOpen(false);
                }}
              >
                Close
              </button>
            </header>
            {notificationsLoading ? (
              <p className="notification-drawer-message">Loading notifications…</p>
            ) : (
              <>
                {notificationError ? (
                  <div className="notification-drawer-error-state">
                    <p className="notification-drawer-message notification-drawer-error">
                      {notificationError}
                    </p>
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => void loadNotifications()}
                    >
                      Try again
                    </button>
                  </div>
                ) : notifications.filter((item) => !dismissedNotifications.includes(item.id)).length === 0 ? (
                  <p className="notification-drawer-message">
                    {notificationsLoading
                      ? "Checking for notifications…"
                      : "You’re all caught up. There are no outstanding notifications."}
                  </p>
                ) : (
                  <div className="notification-request-list">
                    {notifications
                      .filter((item) => !dismissedNotifications.includes(item.id))
                      .map((item) => {
                        const Icon = item.icon === "attendance"
                          ? CalendarDays
                          : item.icon === "advance"
                            ? HandCoins
                            : Users;
                        return (
                          <article className="notification-request" key={item.id}>
                            <div className="notification-request-heading">
                              <span className="notification-request-icon"><Icon size={19} /></span>
                              <strong>{item.title}</strong>
                              <button
                                className="notification-dismiss"
                                type="button"
                                aria-label={`Dismiss notification: ${item.title}`}
                                title="Dismiss notification"
                                onClick={() => dismissNotification(item.id)}
                              >
                                <X size={15} />
                              </button>
                            </div>
                            <div className="notification-request-content">
                              {item.advance ? (
                                <dl>
                                  <div><dt>Employee</dt><dd>{item.advance.employeeName || "Unknown employee"}</dd></div>
                                  <div><dt>Amount</dt><dd>{new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(item.advance.amount)}</dd></div>
                                  <div><dt>Given by</dt><dd>{item.advance.givenBy || "Not specified"}</dd></div>
                                  <div><dt>Status</dt><dd><span className="badge badge-gold">Pending approval</span></dd></div>
                                </dl>
                              ) : (
                                <small>{item.detail}</small>
                              )}
                              <Link
                                className="notification-open-request"
                                href={item.href}
                                onClick={() => setNotificationsOpen(false)}
                              >
                                {item.action} <ArrowRight size={15} />
                              </Link>
                            </div>
                          </article>
                        );
                      })}
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}