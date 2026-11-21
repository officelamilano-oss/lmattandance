"use client";

import { SlidersHorizontal } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import type {
  AttendanceCounts,
  EmployeeAttendanceReportRow,
} from "@/lib/ui-types";
import type { AttendanceStatus } from "@/lib/models";
import { formatDate } from "@/lib/date-format";

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-mark">
        <SlidersHorizontal size={20} />
      </span>
      <strong>{children}</strong>
    </div>
  );
}

export function AttendanceStatusChart({
  attendance,
  subtitle = "Today’s marked staff by attendance status",
}: {
  attendance: AttendanceCounts;
  subtitle?: string;
}) {
  const data = [
    { name: "Absent", value: attendance.A, color: "var(--absent)", status: "a" },
    { name: "Half day", value: attendance.HD, color: "var(--half)", status: "hd" },
    { name: "Present", value: attendance.P, color: "var(--present)", status: "p" },
    { name: "Week off", value: attendance.WO, color: "var(--weekoff)", status: "wo" },
  ].filter((item) => item.value > 0);

  return (
    <section className="panel chart-panel">
      <div className="panel-heading">
        <div>
          <h2>Attendance Summary</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="chart-area">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius="52%"
                outerRadius="76%"
                paddingAngle={3}
                animationDuration={450}
                animationEasing="ease-out"
              >
                {data.map((item) => (
                  <Cell
                    key={item.name}
                    className={`attendance-status-segment attendance-status-${item.status}`}
                    fill={item.color}
                    stroke="var(--cream-light)"
                    strokeWidth={2}
                  />
                ))}
              </Pie>
              <Tooltip />
              <Legend
                verticalAlign="bottom"
                height={30}
                iconType="none"
                wrapperStyle={{ fontSize: 10 }}
                formatter={(value, entry) => (
                  <span className="attendance-chart-legend-label">
                    <i
                      aria-hidden="true"
                      style={{
                        backgroundColor: entry.color,
                        boxShadow: `0 0 8px ${entry.color}`,
                      }}
                    />
                    {value}
                  </span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <Empty>No attendance has been marked for this date.</Empty>
        )}
      </div>
    </section>
  );
}

export function AttendanceTrendChart({
  rows,
  from,
  to,
}: {
  rows: EmployeeAttendanceReportRow[];
  from: string;
  to: string;
}) {
  const groupByMonth =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000 >
    62;
  const periods = new Map<
    string,
    {
      period: string;
      present: number;
      absent: number;
      halfDay: number;
      weekOff: number;
    }
  >();
  for (const row of rows) {
    for (const [status, dates] of Object.entries(row.statusDates) as [
      AttendanceStatus,
      string[],
    ][]) {
      for (const date of dates) {
        const period = groupByMonth ? date.slice(0, 7) : date;
        const counts = periods.get(period) ?? {
          period,
          present: 0,
          absent: 0,
          halfDay: 0,
          weekOff: 0,
        };
        if (status === "P") counts.present += 1;
        if (status === "A") counts.absent += 1;
        if (status === "HD") counts.halfDay += 1;
        if (status === "WO") counts.weekOff += 1;
        periods.set(period, counts);
      }
    }
  }
  const data = [...periods.values()].sort((left, right) =>
    left.period.localeCompare(right.period),
  );

  return (
    <section className="panel chart-panel report-attendance-chart">
      <div className="panel-heading">
        <div>
          <h2>Attendance trend</h2>
          <p>
            {groupByMonth
              ? "Monthly marked attendance"
              : "Daily marked attendance"}{" "}
            · {formatDate(from)} to {formatDate(to)}
          </p>
        </div>
      </div>
      <div className="chart-area">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 8, right: 16, left: -18, bottom: 0 }}
            >
              <CartesianGrid stroke="var(--cream-dark)" vertical={false} />
              <XAxis
                dataKey="period"
                tickFormatter={(period: string) =>
                  groupByMonth
                    ? new Intl.DateTimeFormat("en-GB", {
                        month: "short",
                        year: "numeric",
                        timeZone: "UTC",
                      }).format(new Date(`${period}-01T00:00:00Z`))
                    : formatDate(period)
                }
                tick={{ fill: "var(--muted)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                minTickGap={14}
              />
              <Tooltip
                labelFormatter={(period) =>
                  groupByMonth
                    ? `Month ${new Intl.DateTimeFormat("en-GB", {
                        month: "long",
                        year: "numeric",
                        timeZone: "UTC",
                      }).format(new Date(`${period}-01T00:00:00Z`))}`
                    : `Date ${formatDate(String(period))}`
                }
              />
              <Legend
                iconType="none"
                wrapperStyle={{ fontSize: 10 }}
                formatter={(value, entry) => (
                  <span className="attendance-chart-legend-label">
                    <i
                      aria-hidden="true"
                      style={{
                        backgroundColor: entry.color,
                        boxShadow: `0 0 8px ${entry.color}`,
                      }}
                    />
                    {value}
                  </span>
                )}
              />
              <Bar
                className="attendance-chart-absent"
                dataKey="absent"
                name="Absent"
                stackId="attendance"
                fill="var(--absent)"
                stroke="var(--cream-light)"
                strokeWidth={2}
                animationDuration={450}
                animationEasing="ease-out"
              />
              <Bar
                className="attendance-chart-half"
                dataKey="halfDay"
                name="Half day"
                stackId="attendance"
                fill="var(--half)"
                stroke="var(--cream-light)"
                strokeWidth={2}
                animationDuration={450}
                animationEasing="ease-out"
              />
              <Bar
                className="attendance-chart-present"
                dataKey="present"
                name="Present"
                stackId="attendance"
                fill="var(--present)"
                stroke="var(--cream-light)"
                strokeWidth={2}
                animationDuration={450}
                animationEasing="ease-out"
              />
              <Bar
                className="attendance-chart-weekoff"
                dataKey="weekOff"
                name="Week off"
                stackId="attendance"
                fill="var(--weekoff)"
                stroke="var(--cream-light)"
                strokeWidth={2}
                animationDuration={450}
                animationEasing="ease-out"
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <Empty>No attendance data is available for this date range.</Empty>
        )}
      </div>
    </section>
  );
}
