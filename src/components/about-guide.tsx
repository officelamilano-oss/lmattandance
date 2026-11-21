"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Banknote,
  BookOpen,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  FileSpreadsheet,
  HandCoins,
  Lightbulb,
  Printer,
  Search,
  ShieldCheck,
  Settings2,
  Users,
  Wallet,
} from "lucide-react";

type GuideItem = {
  title: string;
  body: string;
  solution?: string;
  contact?: string;
  steps?: string[];
  tip?: string;
  warning?: string;
};

type GuideSection = {
  id: string;
  title: string;
  lead: string;
  items: GuideItem[];
};

const sections: GuideSection[] = [
  {
    id: "welcome",
    title: "Welcome to LA MILANO",
    lead: "A practical guide to the attendance and workforce tools available in your account.",
    items: [
      {
        title: "What this workspace does",
        body: "LA MILANO Attendance Management System brings employee records, outlet operations, daily attendance, monthly salary, advances, loans, reports and recent activity into one authenticated workspace. The records shown come from the application, not sample dashboard values.",
        tip: "The sidebar only shows pages allowed for your account. Some actions inside a page can require additional permissions.",
      },
      {
        title: "Roles and access",
        body: "Accounts can have a Main Admin, Co-admin or Outlet User role and may be assigned a reusable designation with specific permissions. Outlet Users are limited to their assigned outlets. What you can view or change depends on the permissions assigned to your account.",
        warning: "Contact your administrator if a page or action you need is unavailable. Do not share another user's sign-in details.",
      },
    ],
  },
  {
    id: "getting-started",
    title: "Getting started",
    lead: "Sign in with the account provided to you, then use the workspace navigation to reach your permitted tools.",
    items: [
      {
        title: "Sign in and orient yourself",
        body: "The application requires an administrator-provisioned account. There are no default credentials in this guide. After sign-in, your name and role appear in the sidebar; the top bar shows the current workspace location.",
        steps: [
          "Open the application and enter the username or email and password supplied by your administrator.",
          "Review your name and role in the lower part of the sidebar.",
          "Choose a page from the sidebar. A page missing from the list may not be included in your permissions.",
          "Use the date, month or outlet controls on a page to choose the records you need.",
          "Sign out from the user area when you finish on a shared device.",
        ],
      },
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard",
    lead: "The dashboard is a date-specific operations snapshot, with figures scoped to the outlets and permissions available to your account.",
    items: [
      {
        title: "Date, refresh and headline metrics",
        body: "Choose a dashboard date and use Refresh to request the latest saved data. Active employees and outlets are current counts. Attendance today summarizes saved statuses for the selected date. Net payroll is shown only when salary access is available; otherwise the application displays that salary permission is required. The current dashboard does not show a headline attendance-rate KPI, heatmap or month-end payroll forecast.",
        tip: "The dashboard's LIVE label identifies the operations snapshot panel. It is not a continuous real-time feed.",
      },
      {
        title: "Attendance charts and outlet operations",
        body: "The attendance status chart groups records into Present, Absent, Half-day and Week-off. The outlet chart compares available outlet attendance. The operations table shows each accessible outlet's team size, attendance counts and whether an attendance submission exists for the selected day.",
        warning: "A missing submission means the outlet has no submitted attendance record for that date. Check the date and outlet before following up.",
      },
      {
        title: "Away employees and attendance reports",
        body: "When you have attendance access, the dashboard can show submitted Absent and Half-day records for a selected period. Employee attendance reporting and export controls are shown only when your permissions allow them.",
        steps: [
          "Select the dashboard date and refresh if you want to check another day.",
          "Review the status chart and outlet submission column.",
          "Use the period and employee filters in the attendance report to narrow the results.",
          "Open the Attendance or Reports & exports page to record or export the corresponding data.",
        ],
      },
    ],
  },
  {
    id: "attendance",
    title: "Attendance",
    lead: "Attendance is recorded by date and outlet. Mark the right people and statuses before submitting, because submitted records are locked.",
    items: [
      {
        title: "Choose the date and outlet",
        body: "Use the date field to select a date no later than today. Select an outlet if more than one is available. If you have access to several outlets, the all-outlets view helps review submissions but does not allow editing records in that combined view.",
        steps: [
          "Open Attendance and choose the attendance date.",
          "Choose the outlet you are responsible for, or review the accessible outlets list.",
          "Find the employee by their name or employee code in the displayed employee list.",
        ],
      },
      {
        title: "Mark and submit attendance",
        body: "The available statuses are Present (P), Absent (A), Week off (WO) and Half day (HD). Blank entries are not marked. The application shows status counts and whether the record is a draft or submitted.",
        steps: [
          "Choose the correct status for each employee.",
          "Review the P, A, WO and HD counts and check that no employee is left unintentionally blank.",
          "Use the submission action to submit the outlet's marked attendance.",
          "Confirm that the page shows the submitted state and submission time.",
        ],
        warning: "Submitting locks submitted entries. Do not submit until the date, outlet and employee statuses have been checked. An authorized correction or unlock process may be required to change submitted records.",
      },
      {
        title: "Corrections, history and reports",
        body: "The page displays last-updated information and correction events when available. Correction and unlock actions are permission-controlled; some non-admin users have limits on corrections. For date ranges and employee summaries, use Reports & exports and its attendance filters.",
        tip: "If an entry is locked or you cannot correct it, contact an administrator rather than creating duplicate records.",
      },
    ],
  },
  {
    id: "payroll",
    title: "Monthly salary and payroll",
    lead: "Payroll records show a calculation breakdown and a workflow status. Salary access is restricted by permission.",
    items: [
      {
        title: "Review a payroll month",
        body: "Select a month to view employee payroll records and their period, attendance day counts, gross earnings, approved advance deductions, employee ESI, employee PF, tracked employer PF, loan deduction, net payable and status. Expand Calculation breakdown for daily rate, payable day units, paid absences, week-offs and other calculation details.",
        steps: [
          "Open Monthly salary and select the payroll month.",
          "Check the employee, covered period and attendance counts.",
          "Expand Calculation breakdown and verify deductions and net payable.",
          "Review the status and use only actions enabled for your permissions.",
          "Export the month to Excel or CSV if the export controls are available.",
        ],
      },
      {
        title: "Understand the calculation and approvals",
        body: "The current settings describe a fixed 30-day divisor, configurable paid absences, full pay for week-offs, half-day pay for half-days and full-day deductions for unpaid absences. Approved advances are deducted once when payroll is generated. PF is configured per employee; no statutory tax rules are assumed. The actual payroll record remains the source of truth for a particular employee and period.",
        warning: "Review attendance, employee pay details, advance deductions, loan deductions and the calculation breakdown before generating, adjusting, approving or recording payment. Sensitive payroll actions may be irreversible or permission-restricted.",
      },
      {
        title: "Exports and payslips",
        body: "The salary page offers Excel and CSV exports when your account has salary and report export access. CSV is plain tabular data; Excel is a formatted workbook. A dedicated PDF payslip workflow is not exposed on this page.",
      },
    ],
  },
  {
    id: "employees",
    title: "Employees",
    lead: "Use the employee directory to find and maintain staff records within your assigned outlet scope.",
    items: [
      {
        title: "Find and review an employee",
        body: "Search the directory using the employee information shown in the table. Employee profiles can show attendance and other details, but salary and sensitive information depend on your permissions. Outlet assignment controls which outlet users can see a person.",
        steps: [
          "Open Employees and search for the person using their name or employee code.",
          "Open the employee record or profile to review the available details.",
          "Check outlet assignment and employment information before making a change.",
        ],
      },
      {
        title: "Add, edit or deactivate a record",
        body: "Use the create or edit controls available to your account and complete all required fields shown by the form. The application validates data and may reject duplicate identifiers or invalid values. Deactivation is preferable to removing a person when historical records need to remain available.",
        warning: "Confirm the employee and outlet before saving. Changing a staff record does not mean historical attendance or payroll should be recreated.",
      },
    ],
  },
  {
    id: "advances",
    title: "Advances",
    lead: "Advance records track an amount given to an employee and its review status.",
    items: [
      {
        title: "Record and review an advance",
        body: "Where permitted, select the employee and outlet, enter the amount and date, and provide any requested reference or notes. Review pending records before approving or rejecting them. The page also supports reviewing and editing records within permission and role-specific limits.",
        steps: [
          "Open Advances and check the employee and outlet filters or list.",
          "Record the advance once, using the correct amount and date.",
          "Review the record status and approval controls.",
          "Before payroll is generated, verify which approved advances are eligible for deduction.",
        ],
        warning: "Approved advances are deducted once when payroll is generated. Check for an existing record before adding another to avoid a duplicate deduction.",
      },
    ],
  },
  {
    id: "loans",
    title: "Loans",
    lead: "The loan page is available only to accounts with access to the loan operations area.",
    items: [
      {
        title: "Review a loan and repayment",
        body: "The loan list keeps the original loan amount, remaining balance and monthly salary deduction separate. The monthly deduction is applied to net payroll and the last repayment is capped at the remaining balance.",
        steps: [
          "Open Loans if it is available in your sidebar.",
          "Find the employee and check the original amount and remaining balance.",
          "Select Edit balance to set the current balance and the Outstanding (per-month deduction) amount.",
          "Review the monthly loan deduction in payroll before generating or approving it.",
        ],
        warning: "Older loan records may not have a configured monthly deduction. Set one in Edit balance before expecting an automatic payroll deduction.",
      },
      {
        title: "Illustrative example",
        body: "For illustration only: a ₹10,000 loan balance with a ₹1,000 monthly deduction reduces the balance by ₹1,000 each payroll, with the final deduction limited to what remains. This is not a real employee record.",
      },
    ],
  },
  {
    id: "outlets",
    title: "Outlets",
    lead: "Outlet pages help authorized users review outlet records and connect staff and attendance to the correct location.",
    items: [
      {
        title: "Review outlet operations",
        body: "Use the outlet directory and dashboard operations table to check outlet names, codes, active staff and attendance submission state. Outlet users only see data within their assigned outlet access.",
        steps: [
          "Open Outlets or review the dashboard outlet operations table.",
          "Verify the outlet code and name before selecting it in another module.",
          "Check attendance submissions for the date you are reviewing.",
          "Use employee or report pages to inspect related records where allowed.",
        ],
      },
      {
        title: "Maintain outlet records",
        body: "Add, edit or change outlet status only where the relevant controls are available to you. Historical attendance is linked to outlet records, so keep outlet codes stable and verify the effect of any edit before saving.",
      },
    ],
  },
  {
    id: "access",
    title: "Access management",
    lead: "Authorized administrators can provision accounts, assign outlets and manage saved designation permissions.",
    items: [
      {
        title: "Roles, designations and permissions",
        body: "New accounts use either the privileged Main Admin profile or a saved designation. Designations control staff permissions, and each designated account is assigned to one active outlet. Existing accounts keep their current role and access until an administrator changes them.",
        steps: [
          "Open Access management using an account with access-management permission.",
          "Review a user's role, assigned outlets, designation, permissions and status.",
          "When provisioning an account, select Main Admin or a saved designation and assign an active outlet for designated staff.",
          "Configure only the permissions required for a designation, especially for salary, payroll, user management and exports.",
          "Ask the user to sign in and confirm their expected access after a change.",
        ],
        warning: "Do not grant yourself higher access or share administrator credentials. Restrict salary and payroll permissions to trusted users.",
      },
      {
        title: "Sensitive changes",
        body: "Permission changes, account provisioning and password updates affect access to business and employee data. Verify the selected account and outlet scope before saving. Some actions are available only to administrators.",
      },
    ],
  },
  {
    id: "reports",
    title: "Reports and exports",
    lead: "Reports & exports provides permission-checked data files for the report types available in the application.",
    items: [
      {
        title: "Choose a report and filters",
        body: "Available report types include Attendance, Monthly salary, Employee list, Advances and Audit log. Choose a preset period (Today, Yesterday, This Week, This Month, Last Month or This Year) or choose Custom and set From and To dates. Outlet filters use only the outlets available to your account; attendance also supports an employee filter.",
        steps: [
          "Open Reports & exports and choose the report type.",
          "Select a date preset or enter a custom From and To range.",
          "Choose an outlet and, for attendance, an employee if required.",
          "Review the displayed attendance preview where available.",
          "Export to Excel or CSV and check that the downloaded file matches your filters.",
        ],
      },
      {
        title: "Check results and export format",
        body: "Attendance reports show an on-page preview when the relevant data is available. Choose Excel for a formatted workbook or CSV for plain tabular data. An invalid date range or a report with no matching records may produce an empty or rejected result. Correct the filters and try again.",
        warning: "PDF export is not provided by the report controls. Use the browser's print function only when a printable view is suitable; it is not a data export replacement.",
      },
    ],
  },
  {
    id: "activity",
    title: "Active logs",
    lead: "The activity page shows the latest saved account and operations changes visible to your account.",
    items: [
      {
        title: "Read the audit trail",
        body: "Recent activity displays timestamp, actor, action, entity and reason when available. The page describes the latest 50 changes visible to your account. Reports also include an Audit log export option when your permissions allow it.",
        tip: "Use activity records to investigate a change, but remember that the page is limited to the latest 50 entries for your account; it is not a full-text search interface.",
      },
    ],
  },
  {
    id: "settings",
    title: "Settings",
    lead: "The settings page currently focuses on payroll calculation policy and administrator sign-in credentials.",
    items: [
      {
        title: "Payroll calculation settings",
        body: "The Payroll settings form lets an authorized Main Admin set the business timezone and paid absences per month. The divisor is fixed at 30 days, currency is INR and the advance deduction policy is unpaid-only in the current form. Present and week-off days receive full daily pay, half-days receive half pay and unpaid absences deduct a full day. PF is configured per employee.",
        steps: [
          "Open Settings with an account that has settings access.",
          "Review the timezone and paid absences value.",
          "Change only values agreed for the business and save the form.",
          "Review a payroll preview or calculation after the change.",
        ],
        warning: "Settings do not expose company branding, shift timings or theme preferences in the current application. Do not assume changing this form updates those features.",
      },
      {
        title: "Administrator credentials",
        body: "Main Admin accounts can update the administrator username and password in the credentials panel. Passwords must meet the minimum length shown in the form. If changing a password, confirm it carefully and store it using your organization's approved secure method.",
      },
    ],
  },
  {
    id: "faq",
    title: "Frequently asked questions",
    lead: "Quick answers to common day-to-day questions.",
    items: [
      {
        title: "Why is an outlet showing a missing attendance submission?",
        body: "Check that the selected date and outlet are correct. A missing badge means a submitted attendance record has not been found for that outlet and date. Open Attendance to review and submit records if you are authorized.",
      },
      {
        title: "Why is an employee missing from a report?",
        body: "Check the date range, outlet and employee filters. Also confirm that the employee belongs to an outlet you can access and that matching records exist for the selected period.",
      },
      {
        title: "Why is a salary different from what I expected?",
        body: "Review the attendance counts, covered period, configured paid absences, advance and loan deductions, employee PF and the calculation breakdown. Contact an authorized payroll administrator if the saved inputs or result still appear wrong.",
      },
      {
        title: "How are advances and loan deductions handled?",
        body: "Approved advances are deducted once when payroll is generated. In Employee loans, the remaining balance is tracked separately from the monthly deduction. The configured monthly deduction is suggested in payroll, deducted from net pay and capped at the remaining balance. Review the payroll breakdown before generating or approving payroll.",
      },
      {
        title: "How do I find last month's attendance?",
        body: "Open Reports & exports, choose Attendance and select Last Month or set a custom date range. Apply outlet or employee filters as needed.",
      },
      {
        title: "Why can I not open a page or change a record?",
        body: "Your role, designation permissions, assigned outlets or the record's submitted state may limit access. Ask an administrator to review your account permissions and outlet assignment.",
      },
      {
        title: "What export formats are available?",
        body: "Reports offer Excel and CSV. The report page does not provide a PDF download. Export controls may be hidden when your account lacks the required permissions.",
      },
      {
        title: "What should I check before payroll?",
        body: "Confirm the payroll month, employee and outlet records, attendance submissions, approved advances, loan deductions and each calculation breakdown before generating or approving payroll.",
      },
      {
        title: "What if I find incorrect attendance?",
        body: "Do not create a second entry. If the record is still editable, correct it before submission. If it is locked, contact an authorized administrator about the correction or unlock workflow.",
      },
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    lead: "Try the safe checks below before asking an administrator to investigate.",
    items: [
      {
        title: "Filters return no data",
        body: "Selected dates, outlet or employee do not match available records.",
        solution: "Verify the date range, clear optional filters and confirm that the employee belongs to an accessible outlet.",
        contact: "Contact an administrator if expected records remain missing.",
      },
      {
        title: "Attendance cannot be changed",
        body: "Attendance was submitted and locked, or your permissions do not allow editing.",
        solution: "Verify the date and outlet, then ask an authorized administrator to review the correction or unlock options.",
        contact: "Contact an administrator if you believe the entry should still be editable.",
      },
      {
        title: "A save or export fails",
        body: "Validation, permissions, a server response or an invalid date range.",
        solution: "Read the displayed error, correct the values and retry once.",
        contact: "If it persists, provide an administrator with the page, action and time of the failure—never send passwords.",
      },
      {
        title: "Payroll totals look unexpected",
        body: "Attendance, paid absences, salary setup, approved advances or loan deductions may affect the result.",
        solution: "Inspect the calculation breakdown and source records before taking another action.",
        contact: "Ask an authorized payroll administrator to verify the configured rules.",
      },
      {
        title: "A page is unavailable",
        body: "The account is not signed in, the role lacks permission or the account is outside the outlet scope.",
        solution: "Sign in again if required and verify that you are using the intended account.",
        contact: "Ask an administrator to verify your role, permissions and outlet assignments.",
      },
    ],
  },
  {
    id: "best-practices",
    title: "Best practices",
    lead: "A few consistent checks help protect attendance and payroll data.",
    items: [
      {
        title: "Daily and monthly checks",
        body: "Keep employee and outlet records accurate. Review each outlet's attendance submission promptly. Verify attendance before payroll. Review pending advance approvals and loan balances. Confirm date ranges before exporting. Restrict salary and payroll access to people who need it. Verify important changes after saving and review activity records where available.",
        steps: [
          "Check the outlet and date before recording attendance.",
          "Resolve missing submissions before payroll review.",
          "Check payroll inputs and calculation breakdowns before approval or payment.",
          "Use the narrowest necessary outlet and employee filters for exports.",
          "Sign out of shared devices and never share credentials.",
        ],
      },
    ],
  },
  {
    id: "glossary",
    title: "Glossary",
    lead: "Plain-language definitions for terms used in the workspace.",
    items: [
      {
        title: "Attendance statuses",
        body: "Present (P): recorded as present for the day. Absent (A): recorded as absent. Half-day (HD): recorded for half a day. Week-off (WO): the employee's recorded weekly day off.",
      },
      {
        title: "Payroll terms",
        body: "Attendance rate: a proportion comparing attendance statuses over a chosen period; check the report definition before comparing periods. Gross earnings: earnings before deductions. Net payable: the amount remaining after the deductions displayed in that payroll record. Advance: money given to an employee and tracked in the advance records. EMI: a periodic loan repayment amount, when configured. Outstanding balance: the remaining amount due on a loan after recorded repayments.",
      },
      {
        title: "Operations terms",
        body: "Outlet: a business location linked to employees and attendance. Pending approval: a record awaiting a permitted user's review. Payroll forecast: an estimate of future payroll; the current dashboard does not present a projected month-end payroll forecast.",
      },
    ],
  },
];

const modules = [
  { label: "Attendance", href: "/attendance", icon: CalendarDays },
  { label: "Monthly salary", href: "/salary", icon: Banknote },
  { label: "Employees", href: "/employees", icon: Users },
  { label: "Advances", href: "/advances", icon: Wallet },
  { label: "Loans", href: "/loans", icon: HandCoins },
  { label: "Outlets", href: "/outlets", icon: Building2 },
  { label: "Access", href: "/access", icon: ShieldCheck },
  { label: "Reports", href: "/reports", icon: FileSpreadsheet },
  { label: "Activity", href: "/active-logs", icon: Activity },
  { label: "Settings", href: "/settings", icon: Settings2 },
];

function searchableText(section: GuideSection, item?: GuideItem) {
  return [
    section.title,
    section.lead,
    item?.title,
    item?.body,
    item?.solution,
    item?.contact,
    ...(item?.steps ?? []),
    item?.tip,
    item?.warning,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function AboutGuide() {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    welcome: true,
    "getting-started": true,
  });
  const [activeSection, setActiveSection] = useState("welcome");
  const normalizedQuery = query.trim().toLowerCase();

  const visibleSections = useMemo(
    () =>
      sections
        .map((section) => ({
          ...section,
          items: normalizedQuery
            ? section.items.filter((item) =>
                searchableText(section, item).includes(normalizedQuery),
              )
            : section.items,
        }))
        .filter(
          (section) =>
            !normalizedQuery ||
            section.items.length > 0 ||
            searchableText(section).includes(normalizedQuery),
        ),
    [normalizedQuery],
  );

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const current = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (current) setActiveSection(current.target.id);
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: [0, 0.1, 0.5] },
    );
    sections.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, []);

  function navigateToSection(id: string) {
    setExpanded((current) => ({ ...current, [id]: true }));
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    window.history.replaceState(null, "", `#${id}`);
  }

  function printGuide() {
    setQuery("");
    setExpanded(Object.fromEntries(sections.map((section) => [section.id, true])));
    window.setTimeout(() => window.print(), 100);
  }

  return (
    <div className="content-area about-area">
      <div className="about-hero">
        <div className="about-hero-copy">
          <div className="about-kicker"><BookOpen size={14} /> THE LA MILANO FIELD GUIDE</div>
          <h1>Everything you need to manage your workforce.</h1>
          <p>
            A clear, practical guide to attendance, people, outlets and payroll
            in your LA MILANO workspace.
          </p>
          <div className="about-hero-actions">
            <Link className="button button-primary" href="/">
              Back to Dashboard <ArrowRight size={16} />
            </Link>
            <button className="button about-print-button" onClick={printGuide}>
              <Printer size={16} /> Print guide
            </button>
          </div>
          <div className="about-hero-meta">
            <span><CheckCircle2 size={14} /> Based on current workspace features</span>
            <span>AMS powered by Roshan</span>
          </div>
        </div>
        <div className="about-hero-art" aria-hidden="true">
          <div className="about-orbit about-orbit-one" />
          <div className="about-orbit about-orbit-two" />
          <div className="about-guide-card">
            <span className="about-card-mark">LM</span>
            <span className="about-card-overline">TEAM OPERATIONS</span>
            <strong>People first.<br />Every shift.</strong>
            <span className="about-card-line"><i /> Attendance &amp; payroll guide</span>
          </div>
        </div>
      </div>

      <section className="about-modules" aria-label="Workspace modules">
        <div className="about-section-heading">
          <div>
            <span className="about-eyebrow">YOUR WORKSPACE</span>
            <h2>One place for the everyday essentials</h2>
          </div>
          <span className="about-module-caption">Open a module available to your account</span>
        </div>
        <div className="about-module-grid">
          {modules.map(({ label, href, icon: Icon }) => (
            <Link className="about-module-link" href={href} key={href}>
              <span className="about-module-icon"><Icon size={17} /></span>
              <span>{label}</span>
              <ArrowRight size={14} className="about-module-arrow" />
            </Link>
          ))}
        </div>
      </section>

      <div className="about-documentation">
        <aside className="about-toc">
          <div className="about-toc-title">
            <span className="about-eyebrow">THE GUIDE</span>
            <strong>On this page</strong>
          </div>
          <label className="about-search">
            <Search size={16} />
            <input
              type="search"
              placeholder="Search the guide..."
              value={query}
              onChange={(event) => {
                const value = event.target.value;
                setQuery(value);
                const normalizedValue = value.trim().toLowerCase();
                if (!normalizedValue) return;
                setExpanded((current) => ({
                  ...current,
                  ...Object.fromEntries(
                    sections
                      .filter((section) =>
                        section.items.some((item) =>
                          searchableText(section, item).includes(normalizedValue),
                        ),
                      )
                      .map((section) => [section.id, true]),
                  ),
                }));
              }}
              aria-label="Search guide content"
            />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
                ×
              </button>
            )}
          </label>
          <nav className="about-toc-links" aria-label="Guide sections">
            {(normalizedQuery ? visibleSections : sections).map((section) => (
              <button
                type="button"
                key={section.id}
                className={activeSection === section.id ? "about-toc-active" : ""}
                onClick={() => navigateToSection(section.id)}
              >
                <span>{String(sections.findIndex((item) => item.id === section.id) + 1).padStart(2, "0")}</span>
                {section.title}
              </button>
            ))}
          </nav>
          <div className="about-toc-note">
            <CircleHelp size={16} />
            <p>Need access to a page or action? Ask your workspace administrator to review your permissions.</p>
          </div>
        </aside>

        <main className="about-guide-content">
          <div className="about-guide-intro">
            <div className="about-guide-icon"><BookOpen size={19} /></div>
            <div>
              <span className="about-eyebrow">CLIENT USER MANUAL</span>
              <h2>Learn at your own pace</h2>
              <p>Choose a topic or search for a task. Open any section for its steps, notes and safeguards.</p>
            </div>
            <button
              type="button"
              className="about-expand-all"
              onClick={() => {
                const next = !sections.every((section) => expanded[section.id]);
                setExpanded(Object.fromEntries(sections.map((section) => [section.id, next])));
              }}
            >
              {sections.every((section) => expanded[section.id]) ? "Collapse all" : "Expand all"}
            </button>
          </div>
          {normalizedQuery && (
            <p className="about-search-count" aria-live="polite">
              {visibleSections.reduce((total, section) => total + section.items.length, 0)} matching topics
            </p>
          )}
          {visibleSections.length === 0 ? (
            <div className="about-no-results">
              <Search size={20} />
              <strong>No guide topics found</strong>
              <span>Try a different word, such as “attendance”, “salary” or “outlet”.</span>
            </div>
          ) : (
            <div className="about-section-list">
              {visibleSections.map((section) => {
                const sectionIndex = sections.findIndex((item) => item.id === section.id);
                const isOpen = expanded[section.id] === true;
                return (
                  <section className="about-guide-section" id={section.id} key={section.id}>
                    <button
                      type="button"
                      className="about-section-toggle"
                      aria-expanded={isOpen}
                      onClick={() =>
                        setExpanded((current) => ({
                          ...current,
                          [section.id]: !current[section.id],
                        }))
                      }
                    >
                      <span className="about-section-number">{String(sectionIndex + 1).padStart(2, "0")}</span>
                      <span className="about-section-title">
                        <strong>{section.title}</strong>
                        <small>{section.lead}</small>
                      </span>
                      <ChevronDown size={18} className={isOpen ? "about-chevron-open" : ""} />
                    </button>
                    {isOpen && (
                      <div className="about-section-body">
                        {section.id === "troubleshooting" ? (
                          <div className="about-troubleshooting-table-wrap">
                            <table className="about-troubleshooting-table">
                              <thead>
                                <tr>
                                  <th>Problem</th>
                                  <th>Possible reason</th>
                                  <th>Recommended solution</th>
                                  <th>When to contact the administrator</th>
                                </tr>
                              </thead>
                              <tbody>
                                {section.items.map((item) => (
                                  <tr key={item.title}>
                                    <th scope="row">{item.title}</th>
                                    <td>{item.body}</td>
                                    <td>{item.solution}</td>
                                    <td>{item.contact}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : section.items.map((item) => (
                          <article className="about-guide-item" key={item.title}>
                            <h3>{item.title}</h3>
                            <p>{item.body}</p>
                            {item.steps && (
                              <ol className="about-steps">
                                {item.steps.map((step) => <li key={step}>{step}</li>)}
                              </ol>
                            )}
                            {item.tip && <div className="about-callout about-tip"><Lightbulb size={16} /><p>{item.tip}</p></div>}
                            {item.warning && <div className="about-callout about-warning"><CircleHelp size={16} /><p>{item.warning}</p></div>}
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
          <footer className="about-guide-footer">
            <span>LA MILANO · Attendance Management System</span>
            <span>Features and actions depend on your account permissions.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
