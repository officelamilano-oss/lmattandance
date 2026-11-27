import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri)
  throw new Error("Set MONGODB_URI in .env.local before running setup:db.");

const client = new MongoClient(uri, { appName: "la-milano-attendance-setup" });
const databaseName = process.env.MONGODB_DB || "attendance_payroll";

try {
  await client.connect();
  const db = client.db(databaseName);
  const userCursor = db
    .collection("users")
    .find(
      {
        $or: [
          { email: { $type: "string" } },
          { emailAddress: { $type: "string" } },
        ],
      },
      { projection: { email: 1, emailAddress: 1, emailNormalized: 1 } },
    );
  for await (const user of userCursor) {
    const email = user.email ?? user.emailAddress;
    const normalized = email.trim().toLowerCase();
    if (normalized && user.emailNormalized !== normalized)
      await db
        .collection("users")
        .updateOne(
          { _id: user._id },
          { $set: { emailNormalized: normalized } },
        );
  }
  const employeeCursor = db
    .collection("employees")
    .find(
      {
        $or: [
          { employeeCode: { $type: "string" } },
          { code: { $type: "string" } },
        ],
      },
      { projection: { employeeCode: 1, code: 1, employeeCodeNormalized: 1 } },
    );
  for await (const employee of employeeCursor) {
    const code = employee.employeeCode ?? employee.code;
    const normalized = code.trim().toUpperCase();
    if (normalized && employee.employeeCodeNormalized !== normalized)
      await db
        .collection("employees")
        .updateOne(
          { _id: employee._id },
          { $set: { employeeCodeNormalized: normalized } },
        );
  }
    const outletNames = [
      "Surdhara",
      "Prahladnagar",
      "Manekbaugh",
      "Vastrapur",
      "Nikol",
      "Bodakdev",
      "Bapunagar",
      "Maninagar",
      "Ghodasar",
      "Unassigned outlet",
    ];
    for (let number = 1; number <= outletNames.length; number += 1) {
      const code = `OUT${String(number).padStart(2, "0")}`;
      const existing = await db
        .collection("outlets")
        .findOne(
          { $or: [{ code }, { outletCode: code }, { outlet_code: code }] },
          {
            projection: {
              code: 1,
              name: 1,
              address: 1,
              city: 1,
              managerName: 1,
              contactPhone: 1,
              active: 1,
            },
          },
        );
      if (existing) {
        const defaults = {
          code,
          ...(typeof existing.name === "string" && existing.name.trim()
            ? {}
            : { name: outletNames[number - 1] }),
          ...(typeof existing.address === "string" ? {} : { address: "" }),
          ...(typeof existing.city === "string" ? {} : { city: "" }),
          ...(typeof existing.managerName === "string"
            ? {}
            : { managerName: "" }),
          ...(typeof existing.contactPhone === "string"
            ? {}
            : { contactPhone: "" }),
          ...(typeof existing.active === "boolean"
            ? {}
            : { active: number <= 9 }),
          updatedAt: new Date(),
        };
        await db
          .collection("outlets")
          .updateOne({ _id: existing._id }, { $set: defaults });
        continue;
      }
      await db.collection("outlets").updateOne(
        { code },
        {
          $setOnInsert: {
            code,
            name: outletNames[number - 1],
            address: "",
            city: "",
            managerName: "",
            contactPhone: "",
            active: number <= 9,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );
    }
  const outletCollection = db.collection("outlets");
  const existingOutlets = await outletCollection
    .find({}, { projection: { _id: 1, weekly_off_count: 1 } })
    .sort({ sort_order: 1, code: 1 })
    .toArray();
  for (const [sortOrder, outlet] of existingOutlets.entries()) {
    const weeklyOffCount =
      Number.isInteger(outlet.weekly_off_count) &&
      outlet.weekly_off_count >= 0 &&
      outlet.weekly_off_count <= 7
        ? outlet.weekly_off_count
        : 3;
    await outletCollection.updateOne(
      { _id: outlet._id },
      {
        $set: {
          weekly_off_count: weeklyOffCount,
          sort_order: sortOrder,
        },
      },
    );
  }
  const indexes = [
    [
      "users",
      { emailNormalized: 1 },
      { unique: true, name: "users_email_normalized_unique" },
    ],
    [
      "users",
      { usernameNormalized: 1 },
      {
        unique: true,
        partialFilterExpression: { usernameNormalized: { $type: "string" } },
        name: "users_username_normalized_unique",
      },
    ],
    [
      "users",
      { designationId: 1 },
      { sparse: true, name: "users_designation_id" },
    ],
    [
      "users",
      { active: 1, outletIds: 1 },
      { name: "users_active_outlet_ids" },
    ],
    [
      "designations",
      { nameNormalized: 1 },
      { unique: true, name: "designations_name_normalized_unique" },
    ],
    ["outlets", { code: 1 }, { unique: true, name: "outlets_code_unique" }],
    [
      "outlets",
      { sort_order: 1, code: 1 },
      { name: "outlets_sort_order_code" },
    ],
    [
      "employees",
      { employeeCodeNormalized: 1 },
      { unique: true, name: "employees_code_normalized_unique" },
    ],
    [
      "employees",
      { outletId: 1, active: 1, fullName: 1 },
      { name: "employees_outlet_active_name" },
    ],
    [
      "employeeFiles",
      { employeeId: 1, createdAt: -1, uploadedAt: -1 },
      { name: "employee_files_employee_created_uploaded" },
    ],
    [
      "employeeFaceTemplates",
      { employeeId: 1 },
      { unique: true, name: "employee_face_template_employee_unique" },
    ],
    [
      "kioskDevices",
      { tokenHash: 1 },
      { unique: true, name: "kiosk_device_token_hash_unique" },
    ],
    [
      "kioskDevices",
      { outletId: 1, active: 1 },
      { name: "kiosk_devices_outlet_active" },
    ],
    [
      "attendancePunches",
      { employeeId: 1, date: 1 },
      { unique: true, name: "attendance_punch_employee_date_unique" },
    ],
    [
      "attendancePunches",
      { outletId: 1, date: 1 },
      { name: "attendance_punch_outlet_date" },
    ],
    [
      "attendance",
      { outletId: 1, date: 1 },
      { unique: true, name: "attendance_outlet_date_unique" },
    ],
    [
      "attendance",
      { "entries.employeeId": 1, date: 1 },
      { name: "attendance_employee_date" },
    ],
    [
      "advances",
      { employeeId: 1, date: 1 },
      { name: "advances_employee_date" },
    ],
    [
      "advances",
      { payrollRecordId: 1 },
      { sparse: true, name: "advances_payroll_record" },
    ],
    [
      "loanInstallments",
      { loanId: 1, payrollMonth: 1 },
      { unique: true, name: "loan_installment_month_unique" },
    ],
    [
      "loanInstallments",
      { employeeId: 1, payrollMonth: 1 },
      { name: "loan_installments_employee_month" },
    ],
    [
      "loanTransactions",
      { loanId: 1, createdAt: -1 },
      { name: "loan_transactions_loan_created" },
    ],
    [
      "salaryRecords",
      { employeeId: 1, month: 1, periodStart: 1 },
      {
        unique: true,
        partialFilterExpression: { periodStart: { $type: "string" } },
        name: "salary_employee_period_unique",
      },
    ],
    ["auditLogs", { at: -1 }, { name: "audit_timestamp_desc" }],
    ["auditLogs", { outletId: 1, at: -1 }, { name: "audit_outlet_timestamp" }],
  ];
  const salaryIndexes = await db.collection("salaryRecords").indexes();
  const legacySalaryIndex = salaryIndexes.find(
    (index) =>
      index.unique &&
      JSON.stringify(index.key) ===
        JSON.stringify({ employeeId: 1, month: 1 }),
  );
  if (legacySalaryIndex)
    await db.collection("salaryRecords").dropIndex(legacySalaryIndex.name);
  const attendanceIndexes = await db.collection("attendance").indexes();
  const legacyAttendanceIndex = attendanceIndexes.find(
    (index) =>
      index.unique &&
      JSON.stringify(index.key) ===
        JSON.stringify({ employeeId: 1, date: 1 }),
  );
  if (legacyAttendanceIndex) {
    await db.collection("attendance").dropIndex(legacyAttendanceIndex.name);
    console.log(
      `Removed obsolete unique index attendance.${legacyAttendanceIndex.name}; attendance is unique per outlet and date.`,
    );
  }
  for (const [collection, keys, options] of indexes) {
    try {
      await db.collection(collection).createIndex(keys, options);
    } catch (error) {
      if (error?.code === 85) {
        const existingIndexes = await db.collection(collection).indexes();
        const equivalent = existingIndexes.find(
          (index) =>
            JSON.stringify(index.key) === JSON.stringify(keys) &&
            Boolean(index.unique) === Boolean(options.unique) &&
            Boolean(index.sparse) === Boolean(options.sparse) &&
            JSON.stringify(index.partialFilterExpression ?? null) ===
              JSON.stringify(options.partialFilterExpression ?? null),
        );
        if (equivalent) {
          console.log(
            `Using existing equivalent index ${collection}.${equivalent.name}.`,
          );
          continue;
        }
      }
      if (error?.code === 85 || error?.code === 86)
        throw new Error(
          `Index conflict on ${collection} (${options.name}). Review the existing index; no collection data was removed.`,
          { cause: error },
        );
      throw error;
    }
  }
  const defaultSettings = {
    timezone: process.env.BUSINESS_TIMEZONE || "Asia/Kolkata",
    defaultSalaryMethod: "FIXED_30_DAYS",
    workingDaysDivisor: 30,
    paidAbsences: 0,
    currency: "INR",
    advanceDeductionPolicy: "UNPAID_ONLY",
  };
  await db
    .collection("settings")
    .updateOne(
      { _id: "payroll" },
      {
        $setOnInsert: {
          ...defaultSettings,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  console.log(
    `Database ${databaseName} verified. Indexes/default settings are safe to rerun; existing outlet records were preserved.`,
  );
} finally {
  await client.close();
}
