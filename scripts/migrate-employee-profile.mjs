import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri)
  throw new Error(
    "Set MONGODB_URI in .env.local before running migrate:employee-profile.",
  );

const client = new MongoClient(uri, {
  appName: "la-milano-employee-profile-migration",
});

try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "attendance_payroll");
  const result = await db.collection("employees").updateMany(
    {},
    [
      {
        $set: {
          dateOfBirth: { $ifNull: ["$dateOfBirth", null] },
          gender: { $ifNull: ["$gender", null] },
          designationKey: { $ifNull: ["$designationKey", null] },
          designationGroup: { $ifNull: ["$designationGroup", null] },
          beneficiaryName: { $ifNull: ["$beneficiaryName", null] },
          bankName: { $ifNull: ["$bankName", null] },
          branchName: { $ifNull: ["$branchName", null] },
          accountNumber: { $ifNull: ["$accountNumber", null] },
          ifscCode: { $ifNull: ["$ifscCode", null] },
          panNumber: { $ifNull: ["$panNumber", null] },
          aadhaarNumber: { $ifNull: ["$aadhaarNumber", null] },
          drivingLicenceNumber: { $ifNull: ["$drivingLicenceNumber", null] },
        },
      },
    ],
    { writeConcern: { w: "majority" } },
  );
  console.log(
    `Updated ${result.modifiedCount} employee record(s) with nullable profile fields.`,
  );
} finally {
  await client.close();
}
