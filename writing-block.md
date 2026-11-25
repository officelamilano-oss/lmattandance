# MASTER PROMPT — LA MILANO ATTENDANCE MANAGEMENT SYSTEM
## Complete Premium UI Upgrade + All Pages + Client User Manual

Act as a Senior Full-Stack Developer, UI/UX Designer, SaaS Product Architect, Data Visualization Expert, and Technical Documentation Writer.

I have an existing project called **LA MILANO — Attendance Management System**.

**Live website:** https://lmattandance.vercel.app/

**Existing HTML prototype:** Use the attached `La Milano Attendance (Clickable Prototype) (1).html` as a reference for the existing pages, features, navigation, calculations, and interactions.

**Design reference:** Use the premium dashboard screenshot provided in this conversation as the design inspiration.

Your task is to upgrade my EXISTING application into a complete, polished, enterprise-quality premium attendance and workforce management system. Do not create an unrelated new application or redesign only the dashboard.

## 1. MOST IMPORTANT RULES

Before making changes:

1. Inspect the existing project structure, routes, components, CSS, dependencies, database, APIs, authentication, and current functionality.
2. Open and inspect the live website and the supplied HTML prototype wherever access is available.
3. Identify all existing pages, existing features, incomplete features, missing analytics, and UI inconsistencies.
4. Preserve existing working functionality, business logic, user permissions, employee records, outlet records, salary calculations, and integrations.
5. Do not delete, overwrite, reset, or replace existing production data.
6. Do not rebuild working features from scratch unnecessarily.
7. Implement changes directly in the existing project and follow its existing framework and architecture.
8. If the live website or source code cannot be accessed, clearly identify the limitation and work from the accessible source files. Never pretend that an inaccessible backend has been inspected.
9. Do not stop after creating a mockup, design proposal, or dashboard screenshot. Implement the actual pages and interactions.
10. Do not ask me to approve every individual page. Inspect the project, make sensible design decisions, and complete the implementation.

**Primary goal:** Keep the existing system's identity and functionality while bringing every page to the same premium quality as the provided reference design.

## 2. PREMIUM DESIGN SYSTEM

Use a consistent, sophisticated, modern SaaS dashboard design across the entire application.

### Brand identity

- Brand: LA MILANO
- Product: Attendance Management System
- Branding subtitle: Attendance by Roshan
- Primary accent: refined emerald green.
- Secondary accent: deep red, matching the existing brand identity.
- Background: clean off-white or soft neutral gray in light mode.
- Dark mode: elegant charcoal background with readable text and restrained accent colors.
- Typography: Inter, Outfit, or a similarly clean professional font.
- Icons: consistent Lucide-style outline icons.
- Currency: INR (₹).
- Dates: DD-MM-YYYY or a consistent, clearly labelled date format.

### Visual style

Implement:

- Premium sidebar navigation.
- Elegant top navigation with breadcrumbs.
- Sophisticated page headers and descriptive subtitles.
- KPI cards with clear labels, values, icons, and supporting context.
- Professional charts and data visualization.
- Consistent rounded corners, spacing, typography, borders, and shadows.
- Subtle gradients and refined hover states.
- Smooth, restrained entrance animations.
- Loading skeletons and meaningful empty states.
- Clear success, warning, error, and pending status indicators.
- Attractive tables with search, filters, sorting, pagination, and row actions where appropriate.
- Accessible tooltips and contextual help.
- Responsive layouts for desktop, tablet, and mobile.
- Light and dark themes.
- Consistent modal, drawer, form, dropdown, and confirmation dialog designs.

Avoid excessive gradients, oversized empty spaces, childish colors, excessive animation, and inconsistent component styling. The design should feel premium, professional, trustworthy, and suitable for a real business client.

Use the provided premium dashboard screenshot as the visual direction, not as a reason to remove the existing application's features.

## 3. UPGRADE EVERY EXISTING PAGE

The existing application includes these main navigation areas. Preserve them and upgrade each one individually.

### A. Dashboard

Create a premium analytics dashboard featuring:

**Hero section**
- Welcome heading: "Good service starts with a good team."
- Current reporting date and selected attendance period.
- Outlet filter.
- Date-range filter.
- Quick actions: Mark Attendance, Run Payroll, Manage Team.
- Important operational insights and pending-action indicators.

**KPI cards**
- Attendance rate.
- Net payroll.
- Projected month-end payroll.
- Active employees.
- Full-time employees.
- Part-time employees.
- Total outlets.
- Today's outlet submission rate.
- Pending approvals.

Display relevant comparisons with the previous period only when reliable data is available.

**Analytics**
- Daily attendance trend chart.
- Attendance status donut: Present, Absent, Half-day, Week-off.
- Monthly attendance heatmap.
- Outlet-wise attendance comparison.
- Outlet performance ranking.
- Employee attendance performance.
- Payroll breakdown: gross salary, advances, loan EMI, deductions, net salary.
- Month-end payroll forecast.
- Outlet submission status.
- Today's employee check-ins and attendance statuses.
- Employees currently absent or marked half-day.
- Smart operational suggestions and alerts.

Every applicable dashboard filter should update the related cards, charts, rankings, and tables consistently.

Clicking a KPI, chart segment, outlet, employee, or alert should open the relevant filtered page or detailed view.

Do not show fabricated real-time insights. Use actual application data or clearly labelled demo data.

### B. Attendance

Build a complete attendance management interface with:

- Daily and monthly attendance views.
- Employee, outlet, department, and date filters.
- Attendance statuses: Present, Absent, Half-day, Week-off.
- Check-in time and late-arrival indicators, if supported by the underlying data.
- Employee-wise attendance records.
- Outlet-wise attendance submission status.
- Attendance marking and editing.
- Bulk attendance actions where appropriate.
- Missing attendance alerts.
- Attendance correction and approval workflows, if supported.
- Attendance history and audit information.
- Monthly attendance summary.
- Exportable attendance reports.

Provide clear guidance for marking attendance, changing a status, reviewing records, and submitting attendance.

Do not introduce duplicate records or allow invalid status transitions.

### C. Monthly Salary / Payroll

Upgrade the salary module with:

- Employee-wise monthly salary.
- Gross salary.
- Attendance-based payable salary.
- Applicable deductions.
- Advance deductions.
- Loan EMI deductions.
- Net payable salary.
- Payroll totals and monthly projections.
- Outlet-wise and employee-wise breakdowns.
- Month and employee filters.
- Salary calculation details.
- Payroll preview.
- Pending approvals.
- Payroll processing and confirmation.
- Downloadable salary reports and payslips, where supported.

Keep the existing payroll formula and business rules unless a genuine defect is discovered. Never invent statutory deductions or silently change salary calculations.

Require confirmation before irreversible payroll operations.

### D. Employees

Create a professional employee management page with:

- Employee directory.
- Employee profile and employee ID.
- Department or designation.
- Outlet assignment.
- Employment type: Full-time or Part-time.
- Monthly salary information with appropriate access restrictions.
- Employment status.
- Attendance summary.
- Advance and loan information where permitted.
- Search, sorting, filters, and pagination.
- Add, edit, view, activate, and deactivate employee actions.
- Employee detail drawer or profile page.
- Validation for required fields and duplicate identifiers.

When an employee is selected, provide quick access to relevant attendance and salary history.

Preserve existing employee IDs and related records.

### E. Advances

Build an advance management page with:

- Advance request form.
- Employee selection.
- Amount and request date.
- Approval status.
- Approved and pending advance totals.
- Employee-wise advance history.
- Approval and rejection actions.
- Approval notes where appropriate.
- Monthly payroll deduction visibility.
- Search and filtering.
- Advance reports.

Show clear statuses for Pending, Approved, and Rejected.

Ensure that only authorized users can approve requests and that the same advance is not deducted twice.

### F. Loans

Upgrade the loan management page with:

- Loan creation and employee assignment.
- Principal amount.
- Monthly EMI.
- Amount repaid.
- Outstanding balance.
- Repayment progress indicator.
- EMI history.
- Repayment schedule.
- Next due date, if available.
- Payroll deduction visibility.
- Loan status.
- Employee-wise and outlet-wise filters.
- Loan reports.

Validate repayment amounts and prevent repayments from exceeding the outstanding balance.

Use the existing loan rules and records.

### G. Outlets

Create a complete outlet management interface with:

- Outlet directory.
- Outlet code and name.
- Assigned employees.
- Active employee count.
- Today's attendance.
- Attendance submission status.
- Attendance rate.
- Absence and half-day counts.
- Outlet-wise payroll summary, where permitted.
- Add and edit outlet functionality.
- Activate and deactivate actions, where supported.
- Outlet performance ranking.
- Outlet-wise attendance trends.

Selecting an outlet should provide a detailed operational view and enable navigation to its employees, attendance, and reports.

Never change existing outlet codes or detach their historical records.

### H. Access Management

Build a professional role and permissions management page.

Include existing roles and permissions where available, such as:

- Main Administrator.
- Outlet Manager.
- Accountant.

Support permission categories such as:

- View.
- Create.
- Edit.
- Delete.
- Approve attendance.
- Approve advances.
- View salaries.
- Process payroll.
- Manage employees.
- Manage outlets.
- Export reports.
- Manage users and settings.

Display permissions in a clean matrix with role descriptions and confirmation dialogs for sensitive changes.

Enforce permissions on the backend or in the existing authorization layer, not merely by hiding buttons in the UI.

Do not allow users to grant themselves higher privileges.

### I. Reports & Exports

Create a comprehensive reporting center with report cards and detailed report previews.

Include:

- Attendance reports.
- Employee attendance summaries.
- Absent and half-day reports.
- Outlet-wise attendance reports.
- Attendance submission reports.
- Employee directory reports.
- Monthly salary reports.
- Payroll breakdown reports.
- Advance reports.
- Loan and EMI reports.
- Month-over-month comparisons.
- Operational performance reports.

Features:

- Date range selection.
- Employee and outlet filters.
- Search and sorting.
- Summary metrics.
- Report preview.
- CSV and Excel export where supported.
- PDF export where supported.
- Print-friendly report layout.

Exports must contain the actual filtered data and accurate totals. Handle special characters, date formatting, and currency correctly.

Do not create buttons that claim to export a file but do nothing.

### J. Active Logs / Audit Trail

Upgrade the logs page with:

- Activity timestamp.
- User or actor.
- Action performed.
- Relevant employee, outlet, or record.
- Action category.
- Search and date filters.
- Sensitive action indicators.
- Relevant before-and-after information where safely available.

Record important actions such as attendance changes, payroll operations, advance approvals, loan repayments, employee updates, permission changes, and settings changes.

Use an appropriate audit mechanism for production. Do not present temporary browser-session logs as a permanent audit trail.

### K. Settings

Create a well-organized settings interface with sections or tabs for:

- Company information.
- Company name and branding.
- Attendance configuration.
- Shift timings.
- Salary calculation basis.
- Payroll preferences.
- Theme preferences.
- Notification preferences, if supported.
- User and security preferences.
- Relevant configuration options already present in the project.

Provide Save, Cancel, validation, confirmation, and success/error feedback.

Preserve existing settings and apply changes only where the current application supports them.

**Important:** Add a new navigation item called "About Us" directly below "Settings" in the left sidebar.

The About Us page must be a complete, client-ready product guide, not merely a company introduction.

## 4. NEW PAGE: ABOUT US / COMPLETE USER MANUAL

Create a dedicated page named **About Us** immediately below Settings in the sidebar.

Suggested route: `/about` or the equivalent route convention used by the existing application.

The page must have an exceptionally polished, premium documentation UI suitable for demonstrating the software to a client and teaching them how to operate it.

### About Us page design

Create:

1. A premium hero section featuring the LA MILANO brand.
2. Heading: "Everything you need to manage your workforce."
3. A concise description of the attendance management system.
4. Product version and last-updated information only when known.
5. A visually appealing overview of the system's main modules.
6. A left-side or top documentation navigation menu.
7. Searchable help topics.
8. Expandable guide sections and step-by-step instructions.
9. Numbered steps with icons.
10. Relevant screenshots or annotated interface illustrations when genuine screenshots are available.
11. Helpful tips, warnings, and important notes.
12. Frequently asked questions.
13. A troubleshooting guide.
14. A "Back to Dashboard" action.
15. A print-friendly manual or PDF download option if it can be implemented reliably.

The layout should resemble premium SaaS product documentation, with clear hierarchy, excellent readability, useful navigation, and consistent branding.

### About Us content structure

#### Section 1: Welcome to LA MILANO

Explain:
- What the application is.
- Who should use it.
- How it helps manage employees, outlets, attendance, payroll, advances, and loans.
- The role of the administrator, outlet manager, and accountant, based on actual configured permissions.

#### Section 2: Getting Started

Explain step by step:
1. Open the application.
2. Sign in using the available authentication method.
3. Understand the dashboard and sidebar.
4. Identify the active user and available permissions.
5. Select an outlet or date range where applicable.
6. Learn how to navigate between modules.

Do not invent credentials or describe login features that do not exist.

#### Section 3: Dashboard User Guide

Explain each KPI, card, chart, filter, status badge, and quick action.

For every important feature, use this format:

- **What it does**
- **Why it is useful**
- **How to use it**
- **Step-by-step instructions**
- **What the result means**
- **Common mistakes to avoid**

Explain attendance rate, payroll, active team, outlet submissions, attendance trends, heatmaps, outlet rankings, team performance, and operational alerts where those features exist.

Clearly distinguish calculated metrics from illustrative demo values.

#### Section 4: Attendance User Guide

Explain:
- How to find an employee.
- How to select a date and outlet.
- How to mark Present, Absent, Half-day, and Week-off.
- How to review existing attendance.
- How to correct an incorrect entry, if authorized.
- How to review outlet submission status.
- How to filter attendance records.
- How to generate an attendance report.
- How to understand monthly attendance summaries.

Include practical examples and warnings about duplicate or incorrect entries.

#### Section 5: Monthly Salary / Payroll Guide

Explain:
- Where to view monthly salary.
- How to understand gross and net salary.
- How attendance can affect payable salary according to configured rules.
- How approved advances are reflected.
- How loan EMI deductions work.
- How to preview payroll.
- How to review pending approvals.
- How to export salary reports.
- What to verify before finalizing payroll.

Clearly state that actual salary calculations depend on the application's configured rules.

#### Section 6: Employee Management Guide

Explain how to:
- View the employee directory.
- Search and filter employees.
- Add a new employee.
- Enter employee details.
- Assign an outlet and employment type.
- Update employee information.
- View employee attendance and salary details according to permissions.
- Deactivate an employee safely.

Include required-field explanations and common validation errors.

#### Section 7: Advance Management Guide

Explain:
- How to create an advance request.
- How to select the employee and amount.
- How to review pending requests.
- How authorized users approve or reject requests.
- How to track advance history.
- How an approved advance may affect payroll.
- How to avoid duplicate deductions.

#### Section 8: Loan Management Guide

Explain:
- How to create a loan record.
- How principal and EMI are displayed.
- How to view repayments.
- How to understand outstanding balances.
- How repayments affect the balance.
- How loan deductions relate to payroll.

Use a clearly labelled illustrative example and do not confuse it with real company data.

#### Section 9: Outlet Management Guide

Explain:
- How to view outlets.
- How to add or edit an outlet where permitted.
- How to assign employees.
- How to review attendance submission.
- How to compare outlet performance.
- How to identify missing submissions.
- How to open an outlet's detailed information.

#### Section 10: Access Management Guide

Explain:
- Available roles.
- View, create, edit, delete, and approval permissions.
- How authorized administrators change permissions.
- Why salary and payroll access should be restricted.
- How to verify that permission changes work.
- Security precautions.

Document only the permissions and workflows actually implemented.

#### Section 11: Reports & Exports Guide

Explain:
- Available report types.
- How to select a date range.
- How to filter by outlet and employee.
- How to preview a report.
- How to export CSV, Excel, or PDF where supported.
- How to verify report totals.
- How to handle empty reports and incorrect filters.

#### Section 12: Active Logs Guide

Explain:
- What the activity log shows.
- How to find recent changes.
- How to filter activities.
- Why audit records are important.
- What information is available to each role.

Be transparent about whether the application stores permanent audit records or only temporary session activity.

#### Section 13: Settings Guide

Explain each existing setting:
- What the setting controls.
- When it should be changed.
- How to update it.
- What effect it has on the application.
- What to verify after saving.

Explain company name, salary-day basis, shift timings, and theme settings where supported.

#### Section 14: Frequently Asked Questions

Include practical questions such as:

- Why is an outlet showing a missing attendance submission?
- Why is an employee absent from a filtered report?
- Why is a salary amount different from expectations?
- How are advances reflected in payroll?
- Why is an EMI deduction displayed?
- How do I find a previous month's attendance?
- Why can I not access a particular page?
- How do I export a report?
- What should I check before processing payroll?
- What should I do if I find an incorrect attendance record?

Answers must match the actual application's behavior. If a feature is unavailable, explain that honestly.

#### Section 15: Troubleshooting

Create a professional troubleshooting table with:

- Problem.
- Possible reason.
- Recommended solution.
- When to contact the administrator.

Include common issues involving filters, missing data, permissions, saving changes, report exports, attendance submission, and payroll review.

#### Section 16: Best Practices

Include practical guidance for administrators and outlet managers:

- Review employee records regularly.
- Verify attendance before payroll.
- Resolve missing submissions promptly.
- Review pending advance approvals.
- Verify loan balances and EMI deductions.
- Check report date ranges before exporting.
- Restrict access to sensitive salary information.
- Verify important changes after saving.
- Review audit records where available.

#### Section 17: Glossary

Explain terms such as:

- Present.
- Absent.
- Half-day.
- Week-off.
- Attendance rate.
- Gross salary.
- Net salary.
- Advance.
- EMI.
- Outstanding balance.
- Outlet.
- Pending approval.
- Payroll forecast.

Use simple English and practical examples.

### About Us page interaction requirements

- Clicking a guide topic should open the correct section.
- The search field should search actual guide content.
- Expand/collapse controls must work.
- Sidebar or section navigation must highlight the current section.
- The page must work on desktop and mobile.
- Print mode should hide unnecessary navigation and preserve readable content.
- PDF download must generate a genuine document if provided.
- Do not use fake support contact information or invented company policies.
- Use the actual product name and the actual features of the application.
- Make the manual useful to a non-technical client with no prior training.

**Language requirement:** Use clear, professional English for the client-facing manual. Keep technical terms simple and explain them in plain language.

## 5. ADVANCED ANALYTICS TO ADD WHERE FEASIBLE

After preserving and upgrading existing functionality, implement the following analytics if the available data and business rules support them:

1. Late arrivals and overtime.
2. Absenteeism trends and related payroll impact.
3. Weekday and outlet attendance patterns.
4. Month-over-month attendance and payroll comparisons.
5. Outstanding advances and loan exposure.
6. Month-end payroll forecasts.
7. Missing outlet submission alerts.
8. Consecutive absence alerts.
9. Payroll anomaly indicators.
10. Employee staffing distribution by outlet.
11. Attendance correction history.
12. Exportable management summaries.

Do not fabricate overtime, financial losses, staffing requirements, or predictive insights when the required data is unavailable.

Clearly label estimates and forecasts. Do not present a heuristic as an AI-generated fact.

## 6. FUNCTIONALITY REQUIREMENTS

The premium redesign must be functional, not merely visual.

Verify that:

- All sidebar items navigate correctly.
- The new About Us page is directly below Settings.
- Existing routes remain functional.
- Filters update the intended data.
- Search and sorting work.
- Forms validate input.
- Add and edit actions work.
- Confirmations appear before sensitive actions.
- Permission restrictions are enforced.
- Charts use the correct underlying data.
- Report exports contain the correct records.
- Currency calculations are accurate.
- Dates and time zones are handled consistently.
- Empty states are meaningful.
- Loading and error states are clear.
- Mobile layouts are usable.
- Theme switching works.
- Refreshing a page does not unexpectedly lose important saved data.
- Existing API integrations and database relationships remain intact.

Do not use browser localStorage as a replacement for an existing backend or database.

If the project is currently a standalone demo with sample data, preserve the demo behavior but explicitly identify which operations are not yet connected to persistent storage or production APIs.

## 7. SECURITY, DATA INTEGRITY, AND PERFORMANCE

- Preserve existing authentication and authorization.
- Never expose sensitive salary information to unauthorized users.
- Validate inputs on the server wherever applicable.
- Protect against duplicate submissions and accidental double deductions.
- Use safe confirmation flows for payroll, permissions, deletions, and other sensitive operations.
- Avoid leaking sensitive employee details in URLs, logs, or exports.
- Keep historical attendance and payroll records consistent.
- Optimize charts, large tables, and page rendering.
- Follow accessibility best practices for contrast, keyboard navigation, and focus states.
- Respect reduced-motion preferences.
- Avoid unnecessary dependencies and breaking framework changes.

## 8. IMPLEMENTATION PLAN

Work through these phases without stopping after a visual prototype:

**Phase 1 — Audit**
- Inspect the complete existing project.
- Map every route and feature.
- Identify broken functionality and missing components.
- Understand the current data model and calculations.

**Phase 2 — Design system**
- Establish reusable typography, spacing, colors, buttons, cards, tables, modals, forms, badges, charts, and navigation.
- Apply the design consistently to all pages.

**Phase 3 — Page-by-page upgrade**
- Upgrade Dashboard.
- Upgrade Attendance.
- Upgrade Monthly Salary.
- Upgrade Employees.
- Upgrade Advances.
- Upgrade Loans.
- Upgrade Outlets.
- Upgrade Access Management.
- Upgrade Reports & Exports.
- Upgrade Active Logs.
- Upgrade Settings.

**Phase 4 — About Us**
- Add About Us directly below Settings.
- Implement the complete, searchable, navigable user manual.
- Include step-by-step guidance for every relevant module.
- Add a reliable print or PDF workflow if feasible.

**Phase 5 — Analytics and integrations**
- Implement data-backed analytics and relevant alerts.
- Preserve the existing business rules and integrations.

**Phase 6 — Testing**
- Test every route and important interaction.
- Test create, edit, approval, and export workflows.
- Test role permissions.
- Test calculations against known sample records.
- Test desktop, tablet, and mobile layouts.
- Fix console errors, runtime errors, broken links, and visual regressions.

**Phase 7 — Final delivery**
- Summarize the pages upgraded.
- List new features and analytics.
- Describe the About Us manual.
- Identify incomplete integrations or backend limitations.
- Report the tests actually performed and their results.
- Provide deployment instructions appropriate to the existing project.

## 9. FINAL ACCEPTANCE CRITERIA

The project is complete only when:

- Every existing page has a consistent premium design.
- The dashboard includes meaningful, data-backed analytics.
- Existing features and business logic are preserved.
- All navigation and important interactions work.
- The About Us page appears directly below Settings.
- The About Us page contains a comprehensive client-ready user manual.
- The manual explains how to use every major module.
- Responsive layouts and theme behavior work correctly.
- Reports and exports produce real outputs.
- No fake success messages or misleading real-time analytics are introduced.
- No existing production data is unintentionally lost.
- Testing results and remaining limitations are documented.

**Final instruction:** Start by inspecting the existing project, then implement the complete upgrade directly in the existing codebase. Prioritize correctness, consistency, usability, and maintainability over decorative effects. Do not deliver only recommendations, sample HTML, or a screenshot. Deliver the working upgraded application and a polished client-facing user manual.

If the available environment cannot access or modify the deployed website directly, explain what source code or repository access is needed rather than claiming to have updated the live site.



## CRITICAL UI DESIGN REQUIREMENT — FOLLOW MY PREMIUM REFERENCE SCREENSHOT

The second screenshot I provided is the PRIMARY visual design reference. I want my entire existing LA MILANO Attendance Management System to follow this same premium UI style across ALL pages, not just the Dashboard.

Do not interpret "premium UI" as simply adding colorful cards or charts. Closely follow the reference screenshot's overall layout, spacing, proportions, component styling, typography, and visual hierarchy.

### 1. Match the Reference Design

Implement these design characteristics:

- A premium, light-colored sidebar with rounded corners, subtle borders, and elegant navigation icons.
- LA MILANO branding at the top of the sidebar.
- A modern top header with breadcrumbs, theme controls, profile avatar, and relevant utility actions.
- A large premium hero section with a clean heading, supporting text, subtle green/red border accents, and rounded corners.
- Elegant white or softly tinted cards with thin borders, refined shadows, and generous spacing.
- Large, readable KPI numbers and minimal supporting text.
- Premium emerald-green primary action buttons.
- Restrained red accents that complement the LA MILANO brand.
- Professional charts with clean axes, thin gridlines, tooltips, and consistent colors.
- Modern segmented controls, filter dropdowns, status pills, data tables, and modal dialogs.
- Subtle gradients, glass-like surfaces where appropriate, and smooth hover effects.
- Consistent border radii and spacing across every page.

### 2. Apply the Same Design Language to EVERY Page

The premium appearance must continue consistently across:

Dashboard, Attendance, Monthly Salary, Employees, Advances, Loans, Outlets, Access Management, Reports & Exports, Active Logs, Settings, and the new About Us page.

Each page should have its own relevant layout and features, but all pages must share the same design system, sidebar, header, typography, colors, cards, buttons, tables, filters, and interaction patterns.

Do not leave secondary pages looking like the old interface while only the Dashboard looks modern.

### 3. Dashboard Must Closely Match the Second Screenshot

The Dashboard should feature:

- A premium hero banner with the heading "Good service starts with a good team."
- Compact insight chips and clear quick-action buttons.
- Four prominent analytics cards in a responsive row.
- Attendance rate with a sparkline.
- Net payroll with a trend line.
- Active team summary with employee avatars.
- Today's outlet submission progress with a circular progress indicator.
- A large Today's Check-ins section with All, Present, Late, and Absent filters.
- Professional employee rows with avatars, check-in times, working-hour indicators, and status badges.
- Additional analytics sections for attendance trends, attendance status distribution, outlet performance, payroll breakdown, and alerts.

Use the reference screenshot's composition as the starting point, adapting it to the actual screen size and the application's existing data.

### 4. Premium About Us / User Manual Design

The new About Us page must look like a premium SaaS product documentation center, not a plain text page.

Include a polished hero, documentation navigation, searchable help topics, step-by-step instructional cards, numbered guides, relevant icons, FAQs, troubleshooting, and print-friendly documentation.

Use the same sidebar and header as the rest of the application.

### 5. Visual Quality and Responsive Behavior

- Desktop should closely match the reference screenshot's spacious, premium dashboard layout.
- Tablet layouts should adapt naturally without breaking cards or tables.
- Mobile layouts should use compact navigation and readable, vertically stacked cards.
- Use consistent emerald-green accents, subtle red brand highlights, clean neutral surfaces, and readable typography.
- Avoid unnecessary neon colors, excessive gradients, oversized typography, and inconsistent styles.

### 6. Implementation and Verification

Inspect the reference screenshot while implementing the design. Create reusable design-system components and apply them across the existing application.

After implementation, compare every page against the reference's visual language and fix inconsistencies.

Do not merely describe the design or produce a static mockup. Implement the actual UI in the existing project while preserving its functionality and business logic.

**Priority order:**
1. Visual fidelity to my second reference screenshot.
2. Consistent premium UI across all pages.
3. Preservation of existing functionality and data.
4. Complete About Us user manual.
5. Responsive behavior, accessibility, and testing.



