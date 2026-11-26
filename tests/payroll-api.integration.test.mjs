import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { ObjectId, MongoClient } from "mongodb";
import { hashPassword } from "../src/lib/passwords.ts";

const baseUrl = process.env.PAYROLL_API_TEST_URL;
const databaseName = process.env.MONGODB_DB;
const enabled =
  Boolean(baseUrl) &&
  Boolean(process.env.MONGODB_URI) &&
  process.env.PAYROLL_API_TEST_ALLOW_DB_RESET === "1" &&
  /^payroll_e2e_[a-z0-9_]+$/i.test(databaseName ?? "");

function csvRows(text) {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  return lines.map((line) => {
    const values = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"' && line[index + 1] === '"' && quoted) {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (character === "," && !quoted) {
        values.push(value);
        value = "";
      } else {
        value += character;
      }
    }
    values.push(value);
    return values;
  });
}

test(
  "real payroll preview, report, CSV, and XLSX exports agree for an isolated employee",
  { skip: !enabled },
  async () => {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db(databaseName);
    let ownsDatabase = false;
    try {
      assert.equal(
        (await db.listCollections().toArray()).length,
        0,
        "the explicitly named payroll E2E database must be empty",
      );
      ownsDatabase = true;
      const now = new Date();
      const adminId = new ObjectId();
      const outletId = new ObjectId();
      const outletCode = `IT${outletId.toHexString().slice(-5)}`;
      const email = `payroll-e2e-${outletId.toHexString()}@example.invalid`;
      const password = `Test-${outletId.toHexString()}-Only`;
      await db.collection("users").insertOne({
        _id: adminId,
        email,
        emailNormalized: email,
        usernameNormalized: email,
        name: "Payroll E2E",
        passwordHash: await hashPassword(password),
        role: "MAIN_ADMIN",
        outletIds: [outletId],
        permissions: [],
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      await db.collection("outlets").insertOne({
        _id: outletId,
        code: outletCode,
        name: "Payroll E2E Outlet",
        address: "",
        city: "",
        managerName: "",
        contactPhone: "",
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      await db.collection("settings").insertOne({
        _id: "payroll",
        timezone: "Asia/Kolkata",
        defaultSalaryMethod: "FIXED_30_DAYS",
        workingDaysDivisor: 30,
        paidAbsences: 0,
        countTodayAsNotMarked: true,
        currency: "INR",
        advanceDeductionPolicy: "UNPAID_ONLY",
      });

      const employeeId = new ObjectId();
      const employee = {
        _id: employeeId,
        employeeCode: `E2E${employeeId.toHexString().slice(-6)}`,
        employeeCodeNormalized: `E2E${employeeId.toHexString().slice(-6)}`,
        fullName: "Payroll E2E Employee",
        dateOfJoining: "2026-11-01",
        designation: "Test",
        outletId,
        monthlyBaseSalary: 18000,
        salaryMethod: "FIXED_30_DAYS",
        pfEnabled: false,
        employeePfPercent: 0,
        employerPfPercent: 0,
        esiEnabled: false,
        esiPercent: 0,
        active: true,
        createdBy: adminId,
        createdAt: now,
        updatedAt: now,
      };
      await db.collection("employees").insertOne(employee);

      async function mark(employeeToMark, day, status) {
        const date = `2026-11-${String(day).padStart(2, "0")}`;
        await db.collection("attendance").updateOne(
          { outletId, date },
          {
            $setOnInsert: {
              _id: new ObjectId(),
              outletId,
              date,
              status: "SUBMITTED",
              corrections: [],
              updatedAt: now,
              updatedBy: adminId,
            },
            $push: {
              entries: {
              employeeId: employeeToMark._id,
              status,
              updatedAt: now,
              updatedBy: adminId,
              submitted: true,
              },
            },
          },
          { upsert: true },
        );
      }

      for (let day = 1; day <= 19; day += 1) {
        const status =
          day <= 16 ? "P" : day <= 18 ? "HD" : "WO";
        await mark(employee, day, status);
      }

      const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
      assert.equal(csrfResponse.ok, true);
      const { csrfToken } = await csrfResponse.json();
      const csrfCookies = (csrfResponse.headers.getSetCookie?.() ?? [])
        .map((cookie) => cookie.split(";")[0]);
      const loginResponse = await fetch(
        `${baseUrl}/api/auth/callback/credentials`,
        {
          method: "POST",
          redirect: "manual",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            cookie: csrfCookies.join("; "),
          },
          body: new URLSearchParams({
            csrfToken,
            identifier: email,
            password,
            callbackUrl: baseUrl,
            json: "true",
          }),
        },
      );
      const sessionCookies = (loginResponse.headers.getSetCookie?.() ?? [])
        .map((cookie) => cookie.split(";")[0]);
      assert.ok(
        sessionCookies.some((cookie) =>
          cookie.startsWith("next-auth.session-token="),
        ),
        `credentials login failed with HTTP ${loginResponse.status}`,
      );
      const cookie = [...csrfCookies, ...sessionCookies].join("; ");
      const request = async (path, init = {}) =>
        fetch(`${baseUrl}${path}`, {
          ...init,
          headers: { cookie, ...init.headers },
        });

      const preview = async (end, targetEmployeeId = employeeId) => {
        const params = new URLSearchParams({
          month: "2026-11",
          outletId: outletId.toHexString(),
          employeeId: targetEmployeeId.toHexString(),
          periodStart: "2026-11-01",
          periodEnd: `2026-11-${String(end).padStart(2, "0")}`,
        });
        const response = await request(`/api/payroll/preview?${params}`);
        const payload = await response.json();
        assert.equal(response.status, 200, JSON.stringify(payload));
        return payload.amounts;
      };
      const report = async (end, targetEmployeeId = employeeId) => {
        const params = new URLSearchParams({
          from: "2026-11-01",
          to: `2026-11-${String(end).padStart(2, "0")}`,
          outletId: outletId.toHexString(),
          employeeId: targetEmployeeId.toHexString(),
        });
        const response = await request(
          `/api/reports/employee-attendance?${params}`,
        );
        const payload = await response.json();
        assert.equal(response.status, 200, JSON.stringify(payload));
        return payload.rows[0];
      };
      const dashboard = async (end) => {
        const params = new URLSearchParams({
          parts: "summary",
          date: `2026-11-${String(end).padStart(2, "0")}`,
          outletId: outletId.toHexString(),
        });
        const response = await request(`/api/dashboard?${params}`);
        const payload = await response.json();
        assert.equal(response.status, 200, JSON.stringify(payload));
        return payload.metrics;
      };
      const exported = async (end, targetEmployeeId = employeeId) => {
        const params = new URLSearchParams({
          type: "attendance",
          format: "csv",
          from: "2026-11-01",
          to: `2026-11-${String(end).padStart(2, "0")}`,
          outletId: outletId.toHexString(),
          employeeId: targetEmployeeId.toHexString(),
        });
        const response = await request(`/api/reports/export?${params}`);
        const text = await response.text();
        assert.equal(response.status, 200, text);
        const [headers, ...rows] = csvRows(text);
        return Object.fromEntries(headers.map((header, index) => [header, rows[0][index]]));
      };
      const exportedXlsx = async (end, targetEmployeeId = employeeId) => {
        const params = new URLSearchParams({
          type: "attendance",
          format: "xlsx",
          from: "2026-11-01",
          to: `2026-11-${String(end).padStart(2, "0")}`,
          outletId: outletId.toHexString(),
          employeeId: targetEmployeeId.toHexString(),
        });
        const response = await request(`/api/reports/export?${params}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(response.status, 200, `XLSX export failed: ${response.status}`);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(bytes);
        const sheet = workbook.worksheets[0];
        const headers = sheet.getRow(1).values.slice(1).map(String);
        const values = sheet.getRow(2).values.slice(1);
        return Object.fromEntries(
          headers.map((header, index) => [header, values[index]]),
        );
      };
      const assertSamePay = (
        payroll,
        reportRow,
        exportRow,
        xlsxRow,
        expected,
      ) => {
        assert.equal(
          payroll.grossEarnings,
          expected.gross,
          JSON.stringify({ payroll, expected }),
        );
        assert.equal(payroll.notMarkedDeduction, expected.notMarkedDeduction);
        assert.equal(payroll.netPayable, expected.net);
        assert.equal(payroll.attendanceDeduction, expected.attendanceDeduction);
        assert.equal(payroll.notMarkedDays, expected.notMarkedDays);
        assert.equal(reportRow.payableAmount, payroll.netPayable);
        assert.equal(Number(exportRow["Net Payable INR"]), payroll.netPayable);
        assert.equal(Number(xlsxRow["Net Payable INR"]), payroll.netPayable);
        assert.equal(
          Number(xlsxRow["Attendance Salary Before Deductions INR"]),
          payroll.grossEarnings,
        );
        assert.equal(Number(exportRow["Not Marked"]), payroll.notMarkedDays);
        assert.equal(Number(xlsxRow["Not Marked"]), payroll.notMarkedDays);
        assert.equal(reportRow.grossEarnings, payroll.grossEarnings);
        assert.equal(reportRow.notMarkedDays, payroll.notMarkedDays);
        assert.equal(
          reportRow.notMarkedDeduction,
          payroll.notMarkedDeduction,
        );
        assert.equal(
          Number(exportRow["Attendance Deduction INR"]),
          payroll.attendanceDeduction,
        );
        assert.equal(
          Number(xlsxRow["Attendance Deduction INR"]),
          payroll.attendanceDeduction,
        );
      };

      const caseA = await preview(19);
      assertSamePay(
        caseA,
        await report(19),
        await exported(19),
        await exportedXlsx(19),
        {
          gross: 11400,
          attendanceDeduction: 0,
          notMarkedDays: 0,
          notMarkedDeduction: 0,
          net: 11400,
        },
      );
      const dashboardCaseA = await dashboard(19);
      assert.equal(dashboardCaseA.grossSalary, caseA.grossEarnings);
      assert.equal(dashboardCaseA.netPayable, caseA.netPayable);

      const caseB = await preview(21);
      assertSamePay(
        caseB,
        await report(21),
        await exported(21),
        await exportedXlsx(21),
        {
          gross: 12600,
          attendanceDeduction: 0,
          notMarkedDays: 2,
          notMarkedDeduction: 1200,
          net: 11400,
        },
      );
      const dashboardCaseB = await dashboard(21);
      assert.equal(dashboardCaseB.grossSalary, caseB.grossEarnings);
      assert.equal(dashboardCaseB.netPayable, caseB.netPayable);

      await mark(employee, 20, "P");
      const afterMarkingPresent = await preview(21);
      assert.equal(afterMarkingPresent.notMarkedDays, 1);
      assert.equal(afterMarkingPresent.netPayable - caseB.netPayable, 600);

      const secondEmployeeId = new ObjectId();
      const joiningEmployee = {
        ...employee,
        _id: secondEmployeeId,
        employeeCode: `E2E${secondEmployeeId.toHexString().slice(-6)}`,
        employeeCodeNormalized: `E2E${secondEmployeeId.toHexString().slice(-6)}`,
        fullName: "Payroll E2E Joining Employee",
        dateOfJoining: "2026-11-10",
      };
      await db.collection("employees").insertOne(joiningEmployee);
      for (let day = 10; day <= 19; day += 1)
        await mark(joiningEmployee, day, "P");
      const joiningParams = new URLSearchParams({
        month: "2026-11",
        outletId: outletId.toHexString(),
        employeeId: secondEmployeeId.toHexString(),
        periodStart: "2026-11-01",
        periodEnd: "2026-11-19",
      });
      const joiningResponse = await request(
        `/api/payroll/preview?${joiningParams}`,
      );
      const joiningPayload = await joiningResponse.json();
      assert.equal(
        joiningResponse.status,
        200,
        JSON.stringify(joiningPayload),
      );
      assert.equal(joiningPayload.amounts.grossEarnings, 6000);

      const generateResponse = await request("/api/payroll", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: baseUrl,
        },
        body: JSON.stringify({
          month: "2026-11",
          outletId: outletId.toHexString(),
          employeeId: employeeId.toHexString(),
          periodStart: "2026-11-01",
          periodEnd: "2026-11-19",
          approve: false,
        }),
      });
      const generatePayload = await generateResponse.json();
      assert.equal(generateResponse.status, 201, JSON.stringify(generatePayload));
      const generated = generatePayload.records[0];
      assert.equal(generated.calculation.netPayable, 11400);
      const salaryExportParams = new URLSearchParams({
        type: "salary",
        format: "csv",
        from: "2026-11-01",
        to: "2026-11-19",
        outletId: outletId.toHexString(),
        employeeId: employeeId.toHexString(),
      });
      const salaryExportResponse = await request(
        `/api/reports/export?${salaryExportParams}`,
      );
      const salaryExportText = await salaryExportResponse.text();
      assert.equal(
        salaryExportResponse.status,
        200,
        salaryExportText,
      );
      const [salaryHeaders, ...salaryRows] = csvRows(
        salaryExportText,
      );
      const salaryExportRow = Object.fromEntries(
        salaryHeaders.map((header, index) => [header, salaryRows[0][index]]),
      );
      assert.equal(
        Number(salaryExportRow["Net payable INR"]),
        generated.calculation.netPayable,
      );

      const loanId = new ObjectId();
      const loanCreatedAt = new Date("2026-11-01T00:00:00.000Z");
      await db.collection("loans").insertOne({
        _id: loanId,
        employeeId: secondEmployeeId,
        outletId,
        totalAmount: 600,
        outstandingAmount: 600,
        monthlyDeductionAmount: 600,
        deductionStartMonth: "2026-11",
        status: "ACTIVE",
        createdAt: loanCreatedAt,
        updatedAt: now,
      });
      await db.collection("loanInstallments").insertOne({
        _id: new ObjectId(),
        loanId,
        employeeId: secondEmployeeId,
        outletId,
        payrollMonth: "2026-11",
        openingBalance: 600,
        scheduledDeduction: 600,
        actualDeduction: 0,
        closingBalance: 600,
        status: "SCHEDULED",
        actorId: adminId,
        createdAt: now,
        updatedAt: now,
      });
      await db.collection("advances").insertMany([
        {
          _id: new ObjectId(),
          employeeId: secondEmployeeId,
          outletId,
          date: "2026-11-05",
          approvedDate: "2026-11-08",
          amount: 5000,
          status: "APPROVED",
          givenBy: "Payroll E2E",
          reference: "First advance",
          reason: "Medical expense",
          createdBy: adminId,
          updatedBy: adminId,
          createdAt: now,
          updatedAt: now,
        },
        {
          _id: new ObjectId(),
          employeeId: secondEmployeeId,
          outletId,
          date: "2026-11-06",
          approvedDate: "2026-11-09",
          amount: 2000,
          status: "APPROVED",
          givenBy: "Payroll E2E",
          reference: "Second advance",
          reason: "Rent payment",
          createdBy: adminId,
          updatedBy: adminId,
          createdAt: now,
          updatedAt: now,
        },
      ]);
      const loanPreview = await preview(19, secondEmployeeId);
      const loanReport = await report(19, secondEmployeeId);
      const loanCsv = await exported(19, secondEmployeeId);
      const loanXlsx = await exportedXlsx(19, secondEmployeeId);
      assert.equal(loanPreview.loanDeduction, 600);
      assert.equal(loanReport.totalAdvances, 7000);
      assert.deepEqual(
        loanReport.advanceDetails,
        [
          { date: "2026-11-05", amount: 5000 },
          { date: "2026-11-06", amount: 2000 },
        ],
      );
      assert.equal(loanReport.loanDeduction, 600);
      assert.equal(loanReport.payableAmount, loanPreview.netPayable);
      assert.equal(Number(loanCsv["Loan Deduction INR"]), 600);
      assert.equal(Number(loanCsv["Total Advances INR"]), 7000);
      assert.equal(
        loanCsv["Advance Details (Date / Amount INR)"],
        "05/11/2026: ₹5,000.00, 06/11/2026: ₹2,000.00",
      );
      assert.equal(
        Number(loanCsv["Net Payable INR"]),
        loanPreview.netPayable,
      );
      assert.equal(Number(loanXlsx["Loan Deduction INR"]), 600);
      assert.equal(Number(loanXlsx["Total Advances INR"]), 7000);
      assert.equal(
        loanXlsx["Advance Details (Date / Amount INR)"],
        "05/11/2026: ₹5,000.00, 06/11/2026: ₹2,000.00",
      );
      assert.equal(
        Number(loanXlsx["Net Payable INR"]),
        loanPreview.netPayable,
      );
      assert.equal(
        (await db.collection("loans").findOne({ _id: loanId }))
          .outstandingAmount,
        600,
      );
    } finally {
      if (ownsDatabase) await db.dropDatabase();
      await client.close();
    }
  },
);
