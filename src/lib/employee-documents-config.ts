export const EMPLOYEE_DOCUMENT_MAX_BYTES = 3 * 1024 * 1024;

export const EMPLOYEE_DOCUMENT_MIME_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export const EMPLOYEE_DOCUMENT_ALLOWED_MIME_TYPES = Object.values(
  EMPLOYEE_DOCUMENT_MIME_TYPES,
);

export const EMPLOYEE_DOCUMENT_TYPES = [
  "AADHAAR",
  "PAN",
  "BANK_PROOF",
  "DRIVING_LICENCE",
  "PHOTO",
  "SIGNATURE",
  "OTHER",
] as const;

export type EmployeeDocumentType =
  (typeof EMPLOYEE_DOCUMENT_TYPES)[number];

export const REQUIRED_EMPLOYEE_DOCUMENT_TYPES = [
  "AADHAAR",
  "PHOTO",
  "SIGNATURE",
] as const satisfies readonly EmployeeDocumentType[];

export const OPTIONAL_EMPLOYEE_DOCUMENT_TYPES = [
  "PAN",
] as const satisfies readonly EmployeeDocumentType[];

export function requiredEmployeeDocumentTypes(isDeliveryRider: boolean) {
  return isDeliveryRider
    ? [...REQUIRED_EMPLOYEE_DOCUMENT_TYPES, "DRIVING_LICENCE" as const]
    : [...REQUIRED_EMPLOYEE_DOCUMENT_TYPES];
}
