export const EMPLOYEE_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

export const EMPLOYEE_DOCUMENT_MIME_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
} as const;

export const EMPLOYEE_DOCUMENT_TYPES = [
  "AADHAAR",
  "PAN",
  "BANK_PROOF",
  "DRIVING_LICENCE",
  "PHOTO",
  "OTHER",
] as const;

export type EmployeeDocumentType =
  (typeof EMPLOYEE_DOCUMENT_TYPES)[number];
