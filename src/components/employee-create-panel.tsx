"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import Image from "next/image";
import { RoundedSelect } from "@/components/rounded-select";
import { Check, Download, FileText, LoaderCircle, Plus, X } from "lucide-react";
import type { UserRole } from "@/lib/models";
import type { DashboardOutlet } from "@/lib/ui-types";
import {
  EMPLOYEE_DESIGNATIONS,
  getEmployeeDesignationGroup,
  isDeliveryRiderDesignation,
} from "@/lib/employee-designations";
import { EMPLOYEE_TERMS, EMPLOYEE_TERMS_VERSION } from "@/lib/employee-terms";
import {
  EMPLOYEE_DOCUMENT_MAX_BYTES,
  EMPLOYEE_DOCUMENT_MIME_TYPES,
  EMPLOYEE_DOCUMENT_TYPES,
  OPTIONAL_EMPLOYEE_DOCUMENT_TYPES,
  requiredEmployeeDocumentTypes,
  type EmployeeDocumentType,
} from "@/lib/employee-documents-config";
import { UniformDetailsFields } from "@/components/uniform-details-fields";
import { uniformEntriesFromForm } from "@/lib/uniform-deductions";
import { formatDate } from "@/lib/date-format";
import { downloadTermsPdf, downloadTermsWord } from "@/lib/employee-terms-export";
import { AutoDismissNotice } from "@/components/auto-dismiss-notice";
import { processSignature, rotateSignature } from "@/lib/signature-image";

// Terms paper ke upar dikhne wala logo. Apne project ka logo path yaha daalo
// (same jo sidebar me .brand-logo ke liye use hota hai, /public folder se).
const TERMS_LOGO_SRC = "/lamilano-logo-redTXT.png";

type DraftFields = Record<string, string>;
type UploadItem = {
  file: File;
  documentType: EmployeeDocumentType;
  preview?: string;
};

type StoredUploadItem = Pick<UploadItem, "file" | "documentType">;

const employeeDraftDatabase = "lm-attendance-employee-drafts";
const employeeDraftStore = "uploads";

function openEmployeeDraftDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(employeeDraftDatabase, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(employeeDraftStore);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to open employee draft storage."));
  });
}

function saveDraftUploads(key: string, uploads: UploadItem[]) {
  return openEmployeeDraftDatabase().then(
    (database) =>
      new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(employeeDraftStore, "readwrite");
        transaction.objectStore(employeeDraftStore).put(
          uploads.map(({ file, documentType }) => ({ file, documentType })),
          key,
        );
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          reject(
            transaction.error ??
              new Error("Unable to save uploaded files in the employee draft."),
          );
        };
        transaction.onabort = () => {
          database.close();
          reject(
            transaction.error ??
              new Error("Unable to save uploaded files in the employee draft."),
          );
        };
      }),
  );
}

function isStoredUploadItem(value: unknown): value is StoredUploadItem {
  if (typeof value !== "object" || value === null || !("file" in value))
    return false;
  const upload = value as { file: unknown; documentType?: unknown };
  return (
    upload.file instanceof File &&
    typeof upload.documentType === "string" &&
    EMPLOYEE_DOCUMENT_TYPES.some((type) => type === upload.documentType)
  );
}

function loadDraftUploads(key: string) {
  return openEmployeeDraftDatabase().then(
    (database) =>
      new Promise<StoredUploadItem[]>((resolve, reject) => {
        const transaction = database.transaction(employeeDraftStore, "readonly");
        const request = transaction.objectStore(employeeDraftStore).get(key);
        request.onsuccess = () => {
          database.close();
          const uploads: unknown = request.result;
          resolve(
            Array.isArray(uploads) ? uploads.filter(isStoredUploadItem) : [],
          );
        };
        request.onerror = () => {
          database.close();
          reject(
            request.error ??
              new Error("Unable to restore uploaded files from the employee draft."),
          );
        };
      }),
  );
}

function readImagePreview(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error(`Unable to preview ${file.name}.`));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error(`Unable to preview ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

export function EmployeeCreatePanel({
  user,
  outlets,
  initialOutletId,
  canManageDocuments,
  canManageUniforms,
  canManageShift,
  onCreated,
}: {
  user: { email: string; role: UserRole };
  outlets: DashboardOutlet[];
  initialOutletId?: string;
  canManageDocuments: boolean;
  canManageUniforms: boolean;
  canManageShift: boolean;
  onCreated: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftFields, setDraftFields] = useState<DraftFields>({});
  const [draftRestored, setDraftRestored] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [outletId, setOutletId] = useState(
    initialOutletId || outlets[0]?._id || "",
  );
  const [autoGenerated, setAutoGenerated] = useState(false);
  const [generatedCode, setGeneratedCode] = useState("");
  const [generatedCodeOutletId, setGeneratedCodeOutletId] = useState("");
  const [codeGenerating, setCodeGenerating] = useState(false);
  const [codeGenerationError, setCodeGenerationError] = useState("");
  const [designationKey, setDesignationKey] = useState("");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [previewUpload, setPreviewUpload] = useState<UploadItem | null>(null);
  const [signatureAngle, setSignatureAngle] = useState(0);
  const signatureBase = useRef<File | null>(null);
  const rotateRequest = useRef(0);
  const [pendingEmployeeId, setPendingEmployeeId] = useState("");
  const [pendingEmployeeFormValues, setPendingEmployeeFormValues] = useState<
    Record<string, string>
  >({});
  const [activeRequiredDrop, setActiveRequiredDrop] =
    useState<EmployeeDocumentType | null>(null);
  const [documentUploadProgress, setDocumentUploadProgress] = useState(0);
  const [documentsUploading, setDocumentsUploading] = useState(false);
  const [documentUploadError, setDocumentUploadError] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState("");
  const [dobError, setDobError] = useState("");
  const [termsEmployeeName, setTermsEmployeeName] = useState("");
  const [termsJoiningDate, setTermsJoiningDate] = useState("");
  const [termsSalary, setTermsSalary] = useState("");
  const [termsExporting, setTermsExporting] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingEmployeeValues = useRef<FormData | null>(null);
  const autoCodeRequestOutlet = useRef("");
  const draftUploadsLoaded = useRef(false);
  const termsScrollRef = useRef<HTMLDivElement>(null);
  const storageKey = `employee-create-draft:v1:${user.email}`;
  const selectedOutlet = outlets.find((outlet) => outlet._id === outletId);
  const designationGroup = getEmployeeDesignationGroup(selectedOutlet?.code ?? "");
  const designations = EMPLOYEE_DESIGNATIONS.filter(
    (designation) => designation.group === designationGroup,
  );
  const isOutletUser = user.role === "OUTLET_USER";
  const isMainAdmin = user.role === "MAIN_ADMIN";
  const firstOutletId = initialOutletId || outlets[0]?._id || "";
  const isDeliveryRider = isDeliveryRiderDesignation({
    designationKey,
    designation: EMPLOYEE_DESIGNATIONS.find(
      (item) => item.key === designationKey,
    )?.label,
  });
  const requiredDocuments = requiredEmployeeDocumentTypes(isDeliveryRider);
  const documentUploadTypes: EmployeeDocumentType[] = [
    "AADHAAR",
    ...OPTIONAL_EMPLOYEE_DOCUMENT_TYPES,
    "PHOTO",
    "SIGNATURE",
    ...(isDeliveryRider ? (["DRIVING_LICENCE"] as const) : []),
  ];

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      void (async () => {
        if (!active) return;
        try {
          const savedDraft = window.localStorage.getItem(storageKey);
          if (savedDraft) {
            const parsed: unknown = JSON.parse(savedDraft);
            if (typeof parsed === "object" && parsed !== null) {
              const saved = parsed as Record<string, unknown> & {
                autoGenerated?: boolean;
              };
              const restoredFields = Object.fromEntries(
                Object.entries(saved).filter(
                  ([key, value]) =>
                    key !== "autoGenerated" && typeof value === "string",
                ),
              ) as DraftFields;
              const restored = isOutletUser
                ? Object.fromEntries(
                    Object.entries(restoredFields).filter(
                      ([key]) => key !== "employeeCode",
                    ),
                  )
                : restoredFields;
              setDraftFields(restored);
              setGeneratedCode("");
              setGeneratedCodeOutletId("");
              setOutletId(
                isOutletUser
                  ? firstOutletId
                  : (restored.outletId ?? firstOutletId),
              );
              setDesignationKey(restored.designationKey ?? "");
              setAutoGenerated(!isOutletUser && saved.autoGenerated === true);
              setDraftRestored(true);
              setFormDirty(true);
            }
          } else if (!isOutletUser && firstOutletId) {
            setOutletId(firstOutletId);
          }
          const storedUploads = await loadDraftUploads(storageKey);
          const restoredUploads = await Promise.all(
            storedUploads.map(async (upload) => ({
              ...upload,
              ...(upload.file.type.startsWith("image/")
                ? { preview: await readImagePreview(upload.file) }
                : {}),
            })),
          );
          if (!active) return;
          draftUploadsLoaded.current = true;
          setUploads(restoredUploads);
          if (restoredUploads.length) {
            setDraftRestored(true);
            setFormDirty(true);
          }
        } catch (caught) {
          if (active)
            setError(
              caught instanceof Error
                ? caught.message
                : "Unable to restore the saved employee draft.",
            );
        } finally {
          if (active) setDraftLoaded(true);
        }
      })();
    });
    return () => {
      active = false;
    };
  }, [storageKey, isOutletUser, firstOutletId]);

  useEffect(() => {
    if (!draftUploadsLoaded.current) return;
    void saveDraftUploads(storageKey, uploads).catch((caught: unknown) => {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to save uploaded files in the employee draft.",
      );
    });
  }, [storageKey, uploads]);

  useEffect(() => {
    if (!open || !draftLoaded || !formRef.current) return;
    for (const [name, value] of Object.entries(draftFields)) {
      const field = formRef.current.elements.namedItem(name);
      if (field instanceof HTMLInputElement) {
        if (field.type === "checkbox") field.checked = value === "true";
        else if (field.type !== "file") field.value = value;
      } else if (
        field instanceof HTMLSelectElement ||
        field instanceof HTMLTextAreaElement
      ) {
        field.value = value;
      }
    }
  }, [open, draftLoaded, draftFields]);

  useEffect(() => {
    if (!open && !termsOpen) return;
    function blockEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
    window.addEventListener("keydown", blockEscape, true);
    return () => window.removeEventListener("keydown", blockEscape, true);
  }, [open, termsOpen]);

  useEffect(() => {
    if (!open || !draftLoaded || !formDirty) return;
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [open, draftLoaded, formDirty]);

  // Terms modal khulte hi scroll hamesha top se shuru ho
  useEffect(() => {
    if (termsOpen) termsScrollRef.current?.scrollTo({ top: 0 });
  }, [termsOpen]);

  function saveDraft(
    form: HTMLFormElement,
    generated = autoGenerated,
  ) {
    const nextDraft: DraftFields = {};
    for (const field of Array.from(form.elements)) {
      if (
        !(field instanceof HTMLInputElement ||
          field instanceof HTMLSelectElement ||
          field instanceof HTMLTextAreaElement) ||
        !field.name
      )
        continue;
      if (field instanceof HTMLInputElement) {
        if (field.type === "file") continue;
        if (field.type === "checkbox") {
          nextDraft[field.name] = String(field.checked);
          continue;
        }
        if (field.type === "radio") {
          if (field.checked) nextDraft[field.name] = field.value;
          continue;
        }
        nextDraft[field.name] = field.value;
      } else {
        nextDraft[field.name] = field.value;
      }
    }
    nextDraft.outletId ??= outletId;
    setDraftFields(nextDraft);
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ ...nextDraft, autoGenerated: generated }),
      );
    } catch {
      setError("Could not save the employee draft in this browser.");
    }
  }

  function clearDraft() {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      setError("Could not clear the saved employee draft.");
      return;
    }
    setDraftFields({});
    setDraftRestored(false);
    setFormDirty(false);
    setDesignationKey("");
    setAutoGenerated(false);
    setGeneratedCode("");
    setGeneratedCodeOutletId("");
    setCodeGenerating(false);
    setCodeGenerationError("");
    autoCodeRequestOutlet.current = "";
    setUploads([]);
    signatureBase.current = null;
    setSignatureAngle(0);
    setDobError("");
    formRef.current?.reset();
  }

  function onFormChange(event: FormEvent<HTMLFormElement>) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    setFormDirty(true);
    setError("");
    if (target.name === "designationKey") setDesignationKey(target.value);
    if (target.name === "employeeCode") setAutoGenerated(false);
    if (target.name === "outletId") {
      setOutletId(target.value);
      const codeInput = formRef.current?.elements.namedItem("employeeCode");
      if (codeInput instanceof HTMLInputElement) codeInput.value = "";
      setAutoGenerated(false);
      setGeneratedCode("");
      setGeneratedCodeOutletId("");
      const allowed = EMPLOYEE_DESIGNATIONS.filter(
        (designation) =>
          designation.group ===
          getEmployeeDesignationGroup(
            outlets.find((outlet) => outlet._id === target.value)?.code ?? "",
          ),
      );
      if (!allowed.some((designation) => designation.key === designationKey))
        setDesignationKey("");
    }
    if (target.name === "dateOfBirth") setDobError("");
    if (target.name) {
      setFieldErrors((previous) => {
        if (!(target.name in previous)) return previous;
        const next = { ...previous };
        delete next[target.name];
        return next;
      });
    }
    saveDraft(
      event.currentTarget,
      target.name === "employeeCode" || target.name === "outletId"
        ? false
        : autoGenerated,
    );
  }

  function pendingFormValue(name: string) {
    return pendingEmployeeFormValues[name] ?? "";
  }

  const generateCode = useCallback(async () => {
    if (!outletId) return;
    setBusy(true);
    setCodeGenerating(true);
    setCodeGenerationError("");
    setError("");
    try {
      const response = await fetch(
        `/api/employees?nextCode=true&outletId=${encodeURIComponent(outletId)}`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to generate code.");
      const codeInput = formRef.current?.elements.namedItem("employeeCode");
      if (codeInput instanceof HTMLInputElement) {
        codeInput.value = result.employeeCode;
        const nextDraft = { ...draftFields, employeeCode: result.employeeCode, outletId };
        setDraftFields((previous) => ({
          ...previous,
          employeeCode: result.employeeCode,
        }));
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(nextDraft));
        } catch {
          setError("Could not save the generated employee code in this browser.");
        }
      }
      setGeneratedCode(result.employeeCode);
      setGeneratedCodeOutletId(outletId);
      setAutoGenerated(true);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Unable to generate code.";
      autoCodeRequestOutlet.current = "";
      setCodeGenerationError(message);
      setError(message);
    } finally {
      setBusy(false);
      setCodeGenerating(false);
    }
  }, [draftFields, outletId, storageKey]);

  useEffect(() => {
    if (!open) {
      autoCodeRequestOutlet.current = "";
      return;
    }
    if (
      !draftLoaded ||
      !isOutletUser ||
      pendingEmployeeId ||
      !outletId ||
      (autoGenerated &&
        generatedCode &&
        generatedCodeOutletId === outletId) ||
      autoCodeRequestOutlet.current === outletId
    )
      return;
    autoCodeRequestOutlet.current = outletId;
    void generateCode();
  }, [
    open,
    draftLoaded,
    isOutletUser,
    outletId,
    pendingEmployeeId,
    autoGenerated,
    generatedCode,
    generatedCodeOutletId,
    generateCode,
  ]);

  function validateBeforeTerms(form: HTMLFormElement) {
    if (!form.reportValidity()) return false;
    const values = new FormData(form);
    const birthDate = String(values.get("dateOfBirth") ?? "");
    const joiningDate = String(values.get("dateOfJoining") ?? "");
    if (!isOutletUser && birthDate) {
      const age = ageOnDate(birthDate, joiningDate);
      if (age < 18) {
        setDobError("Employee must be at least 18 on the joining date.");
        return false;
      }
    }
    const selected = EMPLOYEE_DESIGNATIONS.find(
      (designation) => designation.key === designationKey,
    );
    if (
      selected &&
      isDeliveryRiderDesignation({
        designationKey: selected.key,
        designation: selected.label,
      }) &&
      !String(values.get("drivingLicenceNumber") ?? "").trim()
    ) {
      setError("Driving licence number is required for Delivery Rider.");
      setFieldErrors((previous) => ({
        ...previous,
        drivingLicenceNumber: "Driving licence number is required for Delivery Rider.",
      }));
      return false;
    }
    if (isOutletUser) {
      const missingDocuments = requiredDocuments.filter(
        (type) => !uploads.some((upload) => upload.documentType === type),
      );
      if (missingDocuments.length) {
        setDocumentUploadError(
          `Upload all required documents: ${missingDocuments.map(documentTypeLabel).join(", ")}.`,
        );
        return false;
      }
    }
    const name = String(values.get("fullName") ?? "").trim();
    const salary = !isMainAdmin
      ? ""
      : String(values.get("monthlyBaseSalary") ?? "0");
    setTermsEmployeeName(name);
    setTermsJoiningDate(joiningDate);
    setTermsSalary(salary);
    pendingEmployeeValues.current = new FormData(form);
    const formValues: Record<string, string> = {};
    pendingEmployeeValues.current.forEach((value, key) => {
      if (typeof value === "string") formValues[key] = value;
    });
    setPendingEmployeeFormValues(formValues);
    setError("");
    setAccepted(false);
    setTermsOpen(true);
    setOpen(false);
    return true;
  }

  async function createEmployee() {
    const values = pendingEmployeeValues.current;
    if (!values || !accepted) return;
    setBusy(true);
    setError("");
    setFieldErrors({});
    const employeeCode = nullableString(values.get("employeeCode"));
    const body: Record<string, unknown> = {
      employeeCode,
      autoGenerate: isOutletUser || autoGenerated || !employeeCode,
      fullName: values.get("fullName"),
      dateOfJoining: values.get("dateOfJoining"),
      designation: values.get("designation"),
      designationKey: values.get("designationKey"),
      designationGroup: values.get("designationGroup"),
      employmentType: values.get("employmentType"),
      mobile: nullableString(values.get("mobile")),
      outletId,
      termsAccepted: true,
      termsVersion: EMPLOYEE_TERMS_VERSION,
      gender: nullableString(values.get("gender")),
      beneficiaryName: nullableString(values.get("beneficiaryName")),
      bankName: nullableString(values.get("bankName")),
      branchName: nullableString(values.get("branchName")),
      accountNumber: nullableString(values.get("accountNumber")),
      ifscCode: nullableString(values.get("ifscCode")),
      panNumber: nullableString(values.get("panNumber")),
      aadhaarNumber: nullableString(values.get("aadhaarNumber")),
      drivingLicenceNumber: nullableString(values.get("drivingLicenceNumber")),
    };
    if (!isOutletUser) {
      Object.assign(body, {
        dateOfBirth: nullableString(values.get("dateOfBirth")),
      });
    }
    if (isMainAdmin)
      Object.assign(body, {
        monthlyBaseSalary: Number(values.get("monthlyBaseSalary")),
        salaryMethod: values.get("salaryMethod"),
        pfEnabled: values.get("pfEnabled") === "true",
        employeePfPercent: Number(values.get("employeePfPercent")),
        employerPfPercent: Number(values.get("employerPfPercent")),
        esiEnabled: values.get("esiEnabled") === "true",
        esiPercent: Number(values.get("esiPercent")),
      });
    if (canManageShift) {
      const shiftStartTime = nullableString(values.get("shiftStartTime"));
      const shiftEndTime = nullableString(values.get("shiftEndTime"));
      if (shiftStartTime || shiftEndTime)
        Object.assign(body, { shiftStartTime, shiftEndTime });
    }
    if (canManageUniforms)
      body.uniformDeductions = uniformEntriesFromForm(values);
    try {
      let employeeId = pendingEmployeeId;
      if (!employeeId) {
        const response = await fetch("/api/employees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await response.json();
        if (!response.ok) {
          if (Array.isArray(result.details)) {
            setFieldErrors(
              Object.fromEntries(
                result.details
                  .filter(
                    (detail: { path?: string; message?: string }) =>
                      detail.path && detail.message,
                  )
                  .map((detail: { path: string; message: string }) => [
                    detail.path.split(".")[0],
                    detail.message,
                  ]),
              ),
            );
          }
          throw new Error(result.error ?? "Unable to create employee.");
        }
        employeeId = String(result.employee._id);
        if (isOutletUser) {
          setPendingEmployeeId(employeeId);
          pendingEmployeeValues.current?.set(
            "employeeCode",
            String(result.employee.employeeCode),
          );
          setPendingEmployeeFormValues((current) => ({
            ...current,
            employeeCode: String(result.employee.employeeCode),
          }));
        }
      }
      let documentFailure = "";
      if (uploads.length) {
        setDocumentsUploading(true);
        try {
          setDocumentUploadProgress(0);
          const uploadData = new FormData();
          for (const upload of uploads) {
            uploadData.append("files", upload.file);
            uploadData.append("documentTypes", upload.documentType);
          }
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", `/api/employees/${employeeId}/documents`);
            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable)
                setDocumentUploadProgress(
                  Math.round((event.loaded / event.total) * 100),
                );
            };
            xhr.onload = () => {
              let uploadResult: { error?: string };
              try {
                uploadResult = JSON.parse(xhr.responseText);
              } catch {
                reject(
                  new Error("The server returned an invalid upload response."),
                );
                return;
              }
              if (xhr.status < 200 || xhr.status >= 300) {
                reject(
                  new Error(
                    uploadResult.error ?? "Documents could not be uploaded.",
                  ),
                );
                return;
              }
              setDocumentUploadProgress(100);
              resolve();
            };
            xhr.onerror = () =>
              reject(new Error("Network error while uploading documents."));
            xhr.onabort = () =>
              reject(new Error("The document upload was interrupted."));
            xhr.send(uploadData);
          });
        } catch (caught) {
          documentFailure =
            caught instanceof Error
              ? `Documents could not be uploaded: ${caught.message}`
              : "Documents could not be uploaded.";
        } finally {
          setDocumentsUploading(false);
        }
      }
      if (isOutletUser && documentFailure) {
        setError(
          `The employee request is saved as pending, but ${documentFailure} Keep this window open and retry the upload.`,
        );
        try {
          await onCreated();
        } catch {
          setError((previous) =>
            `${previous} The employee list could not be refreshed.`,
          );
        }
        return;
      }
      const completionErrors: string[] = [];
      if (documentFailure)
        completionErrors.push(
          `Employee was created, but ${documentFailure} Open the employee record to retry.`,
        );
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        completionErrors.push(
          "The saved employee draft could not be cleared from this browser.",
        );
      }
      setDraftFields({});
      setDraftRestored(false);
      setFormDirty(false);
      setDesignationKey("");
      setAutoGenerated(false);
      setGeneratedCode("");
      setGeneratedCodeOutletId("");
      setCodeGenerationError("");
      setUploads([]);
      setPendingEmployeeId("");
      setPendingEmployeeFormValues({});
      setTermsOpen(false);
      setOpen(false);
      pendingEmployeeValues.current = null;
      setSuccess(
        isOutletUser
          ? "Employee request submitted for approval."
          : "Employee created successfully.",
      );
      setError(completionErrors.join(" "));
      try {
        await onCreated();
      } catch {
        setError((previous) =>
          [
            previous,
            "Employee was created, but the employee list could not be refreshed.",
          ]
            .filter(Boolean)
            .join(" "),
        );
      }
    } catch (caught) {
      pendingEmployeeValues.current = null;
      setError(
        caught instanceof Error ? caught.message : "Unable to create employee.",
      );
      setTermsOpen(false);
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  async function addFiles(
    files: FileList | File[] | null,
    documentType: EmployeeDocumentType = "OTHER",
  ) {
    if (!files) return;
    const additions: UploadItem[] = [];
    setDocumentUploadError("");
    for (const file of Array.from(files)) {
      const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      if (
        !(extension in EMPLOYEE_DOCUMENT_MIME_TYPES) ||
        file.type !== EMPLOYEE_DOCUMENT_MIME_TYPES[
          extension as keyof typeof EMPLOYEE_DOCUMENT_MIME_TYPES
        ]
      ) {
        setDocumentUploadError(
          `${file.name}: only JPG, JPEG, PNG, WEBP, PDF, and DOCX files are allowed.`,
        );
        continue;
      }
      if (!file.size || file.size > EMPLOYEE_DOCUMENT_MAX_BYTES) {
        setDocumentUploadError(
          `${file.name}: file must be between 1 byte and ${Math.floor(EMPLOYEE_DOCUMENT_MAX_BYTES / (1024 * 1024))} MB.`,
        );
        continue;
      }
      if (
        (documentType === "PHOTO" || documentType === "SIGNATURE") &&
        !file.type.startsWith("image/")
      ) {
        setDocumentUploadError(
          `${file.name}: ${documentTypeLabel(documentType)} must be an image.`,
        );
        continue;
      }
      try {
        const uploadFile =
          documentType === "SIGNATURE"
            ? await processSignature(file)
            : file;
        if (documentType === "SIGNATURE") {
          signatureBase.current = uploadFile;
          setSignatureAngle(0);
        }
        const upload: UploadItem = { file: uploadFile, documentType };
        if (uploadFile.type.startsWith("image/"))
          upload.preview = await readImagePreview(uploadFile);
        additions.push(upload);
      } catch (caught) {
        setDocumentUploadError(
          `${file.name}: ${
            caught instanceof Error
              ? caught.message
              : "Unable to process the selected image."
          }`,
        );
      }
    }
    if (!additions.length) return;
    setUploads((previous) =>
      documentType === "OTHER"
        ? [...previous, ...additions]
        : [
            ...previous.filter((upload) => upload.documentType !== documentType),
            ...additions.slice(-1),
          ],
    );
  }

  function handleDocumentDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDropActive(false);
    addFiles(event.dataTransfer.files);
  }

  function handleRequiredDocumentDrop(
    event: DragEvent<HTMLDivElement>,
    documentType: EmployeeDocumentType,
  ) {
    event.preventDefault();
    setActiveRequiredDrop(null);
    addFiles(event.dataTransfer.files, documentType);
  }

  function wrapAngle(angle: number) {
    return ((((angle + 180) % 360) + 360) % 360) - 180;
  }

  async function applySignatureAngle(angle: number) {
    const normalized = wrapAngle(angle);
    setSignatureAngle(normalized);
    if (!signatureBase.current) return;
    const request = ++rotateRequest.current;
    try {
      const rotated =
        normalized === 0
          ? signatureBase.current
          : await rotateSignature(signatureBase.current, normalized);
      const preview = await readImagePreview(rotated);
      if (request !== rotateRequest.current) return;
      setUploads((previous) =>
        previous.map((item) =>
          item.documentType === "SIGNATURE"
            ? { ...item, file: rotated, preview }
            : item,
        ),
      );
    } catch (caught) {
      setDocumentUploadError(
        caught instanceof Error
          ? caught.message
          : "Could not rotate the signature.",
      );
    }
  }

  if (!draftLoaded) return null;

  const salaryForTerms = !isMainAdmin
    ? ""
    : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(
        Number(termsSalary || 0),
      );
  const signatureUpload = uploads.find(
    (upload) => upload.documentType === "SIGNATURE",
  );
  async function handleTermsDownload(format: "pdf" | "docx") {
    setTermsExporting(true);
    setError("");
    const employeeFileName =
      termsEmployeeName
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "employee";
    const filename = `${employeeFileName}-employment-terms`;
    try {
      if (format === "pdf") {
        const papers = Array.from(
          termsScrollRef.current?.querySelectorAll<HTMLElement>(
            ".terms-paper",
          ) ?? [],
        );
        await downloadTermsPdf(papers, `${filename}.pdf`);
      } else {
        const papers = Array.from(
          termsScrollRef.current?.querySelectorAll<HTMLElement>(
            ".terms-paper",
          ) ?? [],
        );
        await downloadTermsWord(papers, `${filename}.doc`);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `Could not download terms: ${caught.message}`
          : "Could not download the terms document.",
      );
    } finally {
      setTermsExporting(false);
    }
  }

  // Page 1: header + title + intro + SAB rules. Page 2: Declaration + Signatures.
  // (Rules ko do pages me baantna ho to TERMS_PAGE_SPLIT = 14 kar do)
  const TERMS_PAGE_SPLIT = EMPLOYEE_TERMS.rules.length; // sab 18 rules Page 1 par
  const pageOneRules = EMPLOYEE_TERMS.rules.slice(0, TERMS_PAGE_SPLIT);
  const pageTwoRules = EMPLOYEE_TERMS.rules.slice(TERMS_PAGE_SPLIT);
  const signatureRotateControls = (
    <div className="signature-rotate">
      <label className="signature-rotate-slider">
        <span>Rotate signature: {signatureAngle}°</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={signatureAngle}
          onChange={(event) =>
            void applySignatureAngle(Number(event.target.value))
          }
        />
      </label>
      <div className="signature-rotate-buttons">
        <button
          type="button"
          className="button button-small"
          onClick={() => void applySignatureAngle(signatureAngle - 90)}
        >
          ⟲ 90°
        </button>
        <button
          type="button"
          className="button button-small"
          onClick={() => void applySignatureAngle(signatureAngle + 90)}
        >
          ⟳ 90°
        </button>
        <button
          type="button"
          className="button button-small"
          onClick={() => void applySignatureAngle(0)}
        >
          Reset
        </button>
      </div>
    </div>
  );
  const termsLetterhead = (
    <header className="terms-letterhead">
      {logoFailed ? (
        <span className="terms-logo-fallback" aria-hidden="true">LM</span>
      ) : (
        <Image
          className="terms-logo"
          src={TERMS_LOGO_SRC}
          alt="La Milano Pizzeria"
          width={64}
          height={64}
          unoptimized
          onError={() => setLogoFailed(true)}
        />
      )}
      <h1>{EMPLOYEE_TERMS.company}</h1>
    </header>
  );
  const termsLetterfoot = (
    <footer className="terms-letterfoot">
      <div
        style={{
          display: "grid",
          gap: 2,
          justifyItems: "center",
          textAlign: "center",
        }}
      >
        <span>{EMPLOYEE_TERMS.address}</span>
        <span>
          E-mail : {EMPLOYEE_TERMS.email} &nbsp;&nbsp; {EMPLOYEE_TERMS.website}
        </span>
        <strong>CIN NO. : {EMPLOYEE_TERMS.cin}</strong>
      </div>
      <div
        aria-hidden="true"
        style={{
          display: "block",
          width:
            "calc(100% + var(--terms-paper-horizontal-padding) + var(--terms-paper-horizontal-padding))",
          height: 14,
          minHeight: 14,
          flex: "none",
          marginTop: 12,
          marginLeft: "calc(0px - var(--terms-paper-horizontal-padding))",
          marginRight: "calc(0px - var(--terms-paper-horizontal-padding))",
          marginBottom: "calc(0px - var(--terms-paper-bottom-padding))",
          background:
            "linear-gradient(to right, #169a3c 0%, #169a3c 33.33%, #fbc45c 33.33%, #fbc45c 66.66%, #dc2f1f 66.66%, #dc2f1f 100%)",
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
        }}
      />
    </footer>
  );

  return (
    <section className="employee-create-section">
      {success && (
        <AutoDismissNotice message={success} variant="success" />
      )}
      {error && !open && !termsOpen && (
        <AutoDismissNotice message={error} variant="error" />
      )}
      <button
        className="button button-primary"
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Plus size={17} /> Add employee
      </button>
      {draftRestored && !open && !termsOpen && (
        <span className="draft-restored-note">Draft restored</span>
      )}
      {open && (
        <div className="employee-modal-backdrop">
          <section
            className="employee-create-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="employee-create-title"
          >
            <header className="employee-create-modal-header">
              <div>
                <h2 id="employee-create-title">Add employee</h2>
                <p>New team member details</p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close employee form"
                onClick={() => {
                  if (formRef.current) saveDraft(formRef.current);
                  setOpen(false);
                }}
              >
                <X size={18} />
              </button>
            </header>
            <div className="employee-create-modal-body">
              {error && <AutoDismissNotice message={error} variant="error" />}
              <form
                ref={formRef}
                id="employee-create-form"
                className="form-grid employee-create-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveDraft(event.currentTarget);
                  validateBeforeTerms(event.currentTarget);
                }}
                onChange={onFormChange}
              >
                <label className="field">
                  <span>
                    {isOutletUser ? "Employee code (auto-generated)" : "Employee code (optional)"}
                  </span>
                  <div className="employee-code-input">
                    <input
                      name="employeeCode"
                      defaultValue={
                        isOutletUser
                          ? undefined
                          : pendingFormValue("employeeCode") ||
                            draftFields.employeeCode
                      }
                      value={isOutletUser ? generatedCode : undefined}
                      readOnly={isOutletUser}
                      pattern={`${outletPrefix(selectedOutlet?.name ?? "")}[0-9]{4}`}
                      maxLength={7}
                      title="Enter the selected outlet prefix followed by 4 digits."
                    />
                    <input
                      type="hidden"
                      name="autoGenerate"
                      value={String(autoGenerated)}
                      readOnly
                    />
                    {!isOutletUser && (
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={busy || !outletId}
                        onClick={() => void generateCode()}
                      >
                        {busy ? "Generating…" : "Auto-generate"}
                      </button>
                    )}
                  </div>
                  <small>
                    {isOutletUser
                      ? "Generated from the assigned outlet and cannot be changed."
                      : `Leave blank to auto-generate, or enter ${outletPrefix(selectedOutlet?.name ?? "") || "the outlet prefix"} + 4 digits.`}
                  </small>
                  {isOutletUser && codeGenerating && (
                    <small role="status">Generating employee code…</small>
                  )}
                  {isOutletUser && codeGenerationError && (
                    <div className="employee-code-error" role="alert">
                      <span>{codeGenerationError}</span>{" "}
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={busy || !outletId}
                        onClick={() => void generateCode()}
                      >
                        Try again
                      </button>
                    </div>
                  )}
                  {fieldError(fieldErrors, "employeeCode")}
                </label>
                {isOutletUser ? (
                  <input type="hidden" name="outletId" value={outletId} />
                ) : (
                  <label className="field">
                    <span>Outlet</span>
                    <RoundedSelect
                      name="outletId"
                      value={outletId}
                      onChange={(event) => {
                        setOutletId(event.target.value);
                        setDesignationKey("");
                        setGeneratedCode("");
                        setGeneratedCodeOutletId("");
                        setCodeGenerationError("");
                        const codeInput =
                          formRef.current?.elements.namedItem("employeeCode");
                        if (codeInput instanceof HTMLInputElement)
                          codeInput.value = "";
                        setAutoGenerated(false);
                      }}
                      required
                    >
                      {outlets
                        .filter((outlet) => outlet.active)
                        .map((outlet) => (
                          <option key={outlet._id} value={outlet._id}>
                            {outlet.code} · {outlet.name}
                          </option>
                        ))}
                    </RoundedSelect>
                  </label>
                )}
                <label className="field">
                  <span>Full name</span>
                  <input
                    name="fullName"
                    defaultValue={
                      draftFields.fullName || pendingFormValue("fullName")
                    }
                    minLength={2}
                    maxLength={120}
                    required
                  />
                  {fieldError(fieldErrors, "fullName")}
                </label>
                <label className="field">
                  <span>Date of joining</span>
                  <input
                    name="dateOfJoining"
                    type="date"
                    defaultValue={
                      draftFields.dateOfJoining ||
                      pendingFormValue("dateOfJoining")
                    }
                    required
                  />
                  {fieldError(fieldErrors, "dateOfJoining")}
                </label>
                {!isOutletUser && (
                  <label className="field">
                    <span>Date of birth (optional)</span>
                    <input name="dateOfBirth" type="date" max={new Date().toISOString().slice(0, 10)} />
                    {dobError && <small className="field-error">{dobError}</small>}
                    {fieldError(fieldErrors, "dateOfBirth")}
                  </label>
                )}
                <label className="field">
                  <span>Gender</span>
                  <RoundedSelect
                    name="gender"
                    defaultValue={pendingFormValue("gender")}
                    required={isOutletUser}
                  >
                    <option value="">Select gender</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                  </RoundedSelect>
                </label>
                <label className="field">
                  <span>Designation</span>
                  <RoundedSelect
                    name="designationKey"
                    value={designationKey}
                    onChange={(event) => {
                      setDesignationKey(event.target.value);
                      const chosen = EMPLOYEE_DESIGNATIONS.find(
                        (item) => item.key === event.target.value,
                      );
                      const designationInput =
                        formRef.current?.elements.namedItem("designation");
                      if (designationInput instanceof HTMLInputElement)
                        designationInput.value = chosen?.label ?? "";
                    }}
                    required
                  >
                    <option value="">Select designation</option>
                    {designations.map((designation) => (
                      <option key={designation.key} value={designation.key}>
                        {designation.label}
                      </option>
                    ))}
                  </RoundedSelect>
                  <input
                    type="hidden"
                    name="designation"
                    value={
                      EMPLOYEE_DESIGNATIONS.find(
                        (item) => item.key === designationKey,
                      )?.label ?? ""
                    }
                    readOnly
                  />
                  {fieldError(fieldErrors, "designationKey")}
                  {fieldError(fieldErrors, "designation")}
                  <input
                    type="hidden"
                    name="designationGroup"
                    value={designationGroup}
                    readOnly
                  />
                </label>
                <label className="field">
                  <span>Employment type</span>
                  <RoundedSelect
                    name="employmentType"
                    defaultValue={
                      pendingFormValue("employmentType") ||
                      draftFields.employmentType ||
                      "FULL_TIME"
                    }
                  >
                    <option value="FULL_TIME">Full-time</option>
                    <option value="PART_TIME">Part-time</option>
                  </RoundedSelect>
                </label>
                {canManageShift && (
                  <>
                    <label className="field">
                      <span>Shift start (optional)</span>
                      <input
                        name="shiftStartTime"
                        type="time"
                        defaultValue={
                          draftFields.shiftStartTime ||
                          pendingFormValue("shiftStartTime")
                        }
                      />
                      {fieldError(fieldErrors, "shiftStartTime")}
                    </label>
                    <label className="field">
                      <span>Shift end (optional)</span>
                      <input
                        name="shiftEndTime"
                        type="time"
                        defaultValue={
                          draftFields.shiftEndTime ||
                          pendingFormValue("shiftEndTime")
                        }
                      />
                      {fieldError(fieldErrors, "shiftEndTime")}
                    </label>
                    <small className="muted">
                      If set, the 30-minute grace period applies before
                      automatic absence.
                    </small>
                  </>
                )}
                <label className="field">
                  <span>Mobile (optional)</span>
                  <input
                    name="mobile"
                    type="tel"
                    defaultValue={pendingFormValue("mobile")}
                    minLength={7}
                    maxLength={20}
                  />
                  {fieldError(fieldErrors, "mobile")}
                </label>
                {isMainAdmin && (
                  <>
                    <label className="field">
                      <span>Monthly base salary</span>
                      <input name="monthlyBaseSalary" type="number" min="0" step="0.01" required />
                      {fieldError(fieldErrors, "monthlyBaseSalary")}
                    </label>
                    <input type="hidden" name="salaryMethod" value="FIXED_30_DAYS" />
                    <label className="field">
                      <span>PF enabled</span>
                      <RoundedSelect name="pfEnabled" defaultValue="false">
                        <option value="false">No</option>
                        <option value="true">Yes</option>
                      </RoundedSelect>
                    </label>
                    <label className="field">
                      <span>Employee PF %</span>
                      <input name="employeePfPercent" type="number" min="0" max="100" defaultValue="0" required />
                      {fieldError(fieldErrors, "employeePfPercent")}
                    </label>
                    <label className="field">
                      <span>Employer PF %</span>
                      <input name="employerPfPercent" type="number" min="0" max="100" defaultValue="0" required />
                      {fieldError(fieldErrors, "employerPfPercent")}
                    </label>
                    <label className="field">
                      <span>ESI enabled</span>
                      <RoundedSelect name="esiEnabled" defaultValue="false">
                        <option value="false">No</option>
                        <option value="true">Yes</option>
                      </RoundedSelect>
                    </label>
                    <label className="field">
                      <span>Employee ESI %</span>
                      <input name="esiPercent" type="number" min="0" max="100" step="0.01" defaultValue="0.75" required />
                      {fieldError(fieldErrors, "esiPercent")}
                    </label>
                  </>
                )}
                <>
                    {isDeliveryRider && (
                      <label className="field">
                        <span>Driving licence number</span>
                        <input
                          name="drivingLicenceNumber"
                          defaultValue={pendingFormValue("drivingLicenceNumber")}
                          required
                          maxLength={40}
                        />
                        {fieldError(fieldErrors, "drivingLicenceNumber")}
                      </label>
                    )}
                    <fieldset className="employee-form-section">
                      <legend>Bank details</legend>
                      <div className="form-grid">
                        <label className="field"><span>Beneficiary name (optional)</span><input name="beneficiaryName" defaultValue={pendingFormValue("beneficiaryName")} maxLength={120} /></label>
                        <label className="field"><span>Bank name (optional)</span><input name="bankName" defaultValue={pendingFormValue("bankName")} maxLength={120} /></label>
                        <label className="field"><span>Branch name (optional)</span><input name="branchName" defaultValue={pendingFormValue("branchName")} maxLength={120} /></label>
                        <label className="field"><span>Account number (optional)</span><input name="accountNumber" defaultValue={pendingFormValue("accountNumber")} inputMode="numeric" pattern="[0-9]{9,18}" maxLength={18} title="Account number must contain 9 to 18 digits." />{fieldError(fieldErrors, "accountNumber")}</label>
                        <label className="field"><span>IFSC code (optional)</span><input name="ifscCode" defaultValue={pendingFormValue("ifscCode")} pattern="[A-Za-z]{4}0[A-Za-z0-9]{6}" maxLength={11} title="Enter a valid IFSC code." />{fieldError(fieldErrors, "ifscCode")}</label>
                      </div>
                    </fieldset>
                    <fieldset className="employee-form-section">
                      <legend>Identity</legend>
                      <div className="form-grid">
                        <label className="field"><span>PAN card number (optional)</span><input name="panNumber" defaultValue={pendingFormValue("panNumber")} pattern="[A-Za-z]{5}[0-9]{4}[A-Za-z]" maxLength={10} title="Enter PAN in the format AAAAA9999A." />{fieldError(fieldErrors, "panNumber")}</label>
                        <label className="field"><span>Aadhaar card number (optional)</span><input name="aadhaarNumber" defaultValue={pendingFormValue("aadhaarNumber")} inputMode="numeric" pattern="[0-9]{12}" maxLength={12} title="Aadhaar number must contain exactly 12 digits." />{fieldError(fieldErrors, "aadhaarNumber")}</label>
                      </div>
                    </fieldset>
                    {(canManageDocuments || isOutletUser) && (
                      <fieldset className="employee-form-section">
                        <legend>Documents / images</legend>
                        {isOutletUser ? (
                          <div className="employee-required-documents">
                            {documentUploadTypes.map((type) => {
                              const isRequired = requiredDocuments.some(
                                (requiredType) => requiredType === type,
                              );
                              const upload = uploads.find(
                                (item) => item.documentType === type,
                              );
                              const imageOnly =
                                type === "PHOTO" || type === "SIGNATURE";
                              return (
                                <div
                                  className="employee-required-document"
                                  key={type}
                                >
                                  <span className="employee-required-document-label">
                                    {documentTypeLabel(type)} ({isRequired ? "required" : "optional"})
                                  </span>
                                  <div
                                    className={`employee-required-document-dropzone${activeRequiredDrop === type ? " is-active" : ""}`}
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`${documentTypeLabel(type)} upload`}
                                    onClick={(event) => {
                                      if (event.target instanceof HTMLInputElement)
                                        return;
                                      event.currentTarget
                                        .querySelector<HTMLInputElement>(
                                          'input[type="file"]',
                                        )
                                        ?.click();
                                    }}
                                    onKeyDown={(event) => {
                                      if (
                                        event.key === "Enter" ||
                                        event.key === " "
                                      ) {
                                        event.preventDefault();
                                        event.currentTarget
                                          .querySelector<HTMLInputElement>(
                                            'input[type="file"]',
                                          )
                                          ?.click();
                                      }
                                    }}
                                    onDragEnter={(event) => {
                                      event.preventDefault();
                                      setActiveRequiredDrop(type);
                                    }}
                                    onDragOver={(event) => {
                                      event.preventDefault();
                                      setActiveRequiredDrop(type);
                                    }}
                                    onDragLeave={(event) => {
                                      event.preventDefault();
                                      if (
                                        !event.currentTarget.contains(
                                          event.relatedTarget as Node | null,
                                        )
                                      )
                                        setActiveRequiredDrop(null);
                                    }}
                                    onDrop={(event) =>
                                      handleRequiredDocumentDrop(event, type)
                                    }
                                  >
                                    <input
                                      key={`${type}-${upload?.file.name ?? "empty"}`}
                                      className="employee-required-document-input"
                                      type="file"
                                      hidden
                                      accept={
                                        imageOnly
                                          ? ".jpg,.jpeg,.png,.webp"
                                          : ".jpg,.jpeg,.png,.webp,.pdf,.docx"
                                      }
                                      aria-label={`Choose ${documentTypeLabel(type)} file`}
                                      onChange={(event) => {
                                        addFiles(event.target.files, type);
                                        event.target.value = "";
                                      }}
                                    />
                                    {type === "SIGNATURE" && upload?.preview ? (
                                      <Image
                                        className="employee-signature-upload-image"
                                        src={upload.preview}
                                        alt="Transparent signature preview"
                                        width={280}
                                        height={64}
                                        unoptimized
                                      />
                                    ) : (
                                      <FileText size={21} aria-hidden="true" />
                                    )}
                                    <strong>
                                      {upload
                                        ? type === "SIGNATURE"
                                          ? "Signature ready"
                                          : upload.file.name
                                        : `${documentTypeLabel(type)} yahan upload karein`}
                                    </strong>
                                    <span>
                                      {upload
                                        ? "Click to replace or drag another file"
                                        : "Click to choose a file or drag it here"}
                                    </span>
                                  </div>
                                  <small className="employee-required-document-help">
                                    {imageOnly
                                      ? "JPG, PNG or WEBP · up to 3 MB"
                                      : "JPG, PNG, WEBP, PDF or DOCX · up to 3 MB"}
                                  </small>
                                  {type === "SIGNATURE" &&
                                    upload &&
                                    signatureRotateControls}
                                  {upload && (
                                    <div className="employee-required-document-file">
                                      {upload.preview ? (
                                        <button
                                          type="button"
                                          className="employee-upload-preview-link"
                                          onClick={() => setPreviewUpload(upload)}
                                          aria-label={`Preview ${upload.file.name}`}
                                        >
                                          {upload.file.name} ·{" "}
                                          {(upload.file.size / (1024 * 1024)).toFixed(2)} MB
                                        </button>
                                      ) : (
                                        <span>
                                          {upload.file.name} ·{" "}
                                          {(upload.file.size / (1024 * 1024)).toFixed(2)} MB
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        className="icon-button"
                                        disabled={busy}
                                        aria-label={`Remove ${documentTypeLabel(type)} file`}
                                        onClick={() =>
                                          {
                                            setUploads((previous) =>
                                              previous.filter(
                                                (item) =>
                                                  item.documentType !== type,
                                              ),
                                            );
                                            if (type === "SIGNATURE") {
                                              signatureBase.current = null;
                                              setSignatureAngle(0);
                                            }
                                          }
                                        }
                                      >
                                        <X size={15} />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <>
                            <div
                              className={`employee-document-dropzone${dropActive ? " is-active" : ""}`}
                              role="button"
                              tabIndex={0}
                              aria-label="Choose employee documents"
                              onClick={() => fileInputRef.current?.click()}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  fileInputRef.current?.click();
                                }
                              }}
                              onDragEnter={(event) => {
                                event.preventDefault();
                                setDropActive(true);
                              }}
                              onDragOver={(event) => {
                                event.preventDefault();
                                setDropActive(true);
                              }}
                              onDragLeave={(event) => {
                                event.preventDefault();
                                if (
                                  !event.currentTarget.contains(
                                    event.relatedTarget as Node | null,
                                  )
                                )
                                  setDropActive(false);
                              }}
                              onDrop={handleDocumentDrop}
                            >
                              <input
                                ref={fileInputRef}
                                className="employee-document-input"
                                type="file"
                                accept=".jpg,.jpeg,.png,.webp,.pdf,.docx"
                                multiple
                                onChange={(event) => {
                                  addFiles(event.target.files);
                                  event.target.value = "";
                                }}
                              />
                              <FileText size={23} aria-hidden="true" />
                              <strong>Drag &amp; drop files here or click to browse</strong>
                              <span>JPG, PNG, WEBP, PDF, DOCX · up to 3 MB per file</span>
                            </div>
                            {uploads.map((upload, index) => (
                              <div className="employee-upload-item" key={`${upload.file.name}-${upload.file.size}-${index}`}>
                                {upload.preview ? (
                                  <button
                                    type="button"
                                    className="employee-upload-thumbnail-button"
                                    onClick={() => setPreviewUpload(upload)}
                                    aria-label={`Preview ${upload.file.name}`}
                                  >
                                    <Image
                                      className="employee-file-preview"
                                      src={upload.preview}
                                      alt=""
                                      width={42}
                                      height={42}
                                      unoptimized
                                    />
                                  </button>
                                ) : (
                                  <FileText size={16} />
                                )}
                                {upload.preview ? (
                                  <button
                                    type="button"
                                    className="employee-upload-preview-link"
                                    onClick={() => setPreviewUpload(upload)}
                                    aria-label={`Preview ${upload.file.name}`}
                                  >
                                    {upload.file.name} ·{" "}
                                    {(upload.file.size / (1024 * 1024)).toFixed(2)} MB
                                  </button>
                                ) : (
                                  <span>
                                    {upload.file.name} ·{" "}
                                    {(upload.file.size / (1024 * 1024)).toFixed(2)} MB
                                  </span>
                                )}
                                <RoundedSelect
                                  aria-label={`Document type for ${upload.file.name}`}
                                  value={upload.documentType}
                                  onChange={(event) =>
                                    setUploads((previous) =>
                                      previous.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, documentType: event.target.value as EmployeeDocumentType }
                                          : item,
                                      ),
                                    )
                                  }
                                >
                                  {EMPLOYEE_DOCUMENT_TYPES.map((itemType) => (
                                    <option key={itemType} value={itemType}>{documentTypeLabel(itemType)}</option>
                                  ))}
                                </RoundedSelect>
                                <button
                                  type="button"
                                  className="icon-button"
                                  disabled={busy}
                                  aria-label={`Remove ${upload.file.name}`}
                                  onClick={() => {
                                    setUploads((previous) =>
                                      previous.filter(
                                        (_, itemIndex) => itemIndex !== index,
                                      ),
                                    );
                                    if (upload.documentType === "SIGNATURE") {
                                      signatureBase.current = null;
                                      setSignatureAngle(0);
                                    }
                                  }}
                                >
                                  <X size={15} />
                                </button>
                              </div>
                            ))}
                            {signatureUpload && signatureRotateControls}
                          </>
                        )}
                        {documentUploadError && (
                          <p className="employee-upload-error" role="alert">
                            {documentUploadError}
                          </p>
                        )}
                        {documentsUploading && uploads.length > 0 && (
                          <div className="employee-upload-progress">
                            <div
                              className="employee-upload-progress-track"
                              role="progressbar"
                              aria-label="Document upload progress"
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={documentUploadProgress}
                            >
                              <span
                                style={{ width: `${documentUploadProgress}%` }}
                              />
                            </div>
                            <small>{documentUploadProgress}% uploaded</small>
                          </div>
                        )}
                      </fieldset>
                    )}
                </>
                {canManageUniforms && <UniformDetailsFields />}
              </form>
            </div>
            <footer className="employee-create-modal-footer">
              {(draftRestored || Object.keys(draftFields).length > 0) && (
                <div className="draft-restored-note">
                  <span>{draftRestored ? "Draft restored" : "Draft saved"}</span>
                  <button
                    type="button"
                    className="button button-small"
                    disabled={!!pendingEmployeeId}
                    onClick={clearDraft}
                  >
                    Clear form
                  </button>
                </div>
              )}
              <button
                form="employee-create-form"
                className="button button-primary"
                disabled={busy}
              >
                <FileText size={16} /> Read terms &amp; add employee
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* ================= TERMS MODAL (one-page paper + sticky top action bar) ================= */}
      {termsOpen && (
        <div className="employee-modal-backdrop employee-terms-backdrop">
          <section
            className="terms-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="employee-terms-title"
          >
            {/* Ye bar hamesha upar rahegi, scroll hone par bhi */}
            <div className="terms-actionbar">
              <div className="terms-actionbar-title">
                <h2 id="employee-terms-title">Employment terms</h2>
                <span>{EMPLOYEE_TERMS_VERSION}</span>
              </div>
              <label className="terms-accept">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => {
                    const isAccepted = event.target.checked;
                    setAccepted(isAccepted);
                    if (isAccepted) {
                      termsScrollRef.current?.scrollTo({
                        top: termsScrollRef.current.scrollHeight,
                        behavior: "smooth",
                      });
                    }
                  }}
                />
                <span>
                  I have read, understood and accept the above rules / मैंने ऊपर दिए गये नियम पढ़ और समझ लिए हैं और मैं सहमत हूँ
                </span>
              </label>
              {error && <AutoDismissNotice message={error} variant="error" />}
              <div className="terms-actions">
                <details className="terms-download-menu">
                  <summary
                    className="button button-secondary terms-download-trigger"
                    aria-label="Download terms and conditions"
                    title="Download terms and conditions"
                  >
                    {termsExporting ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Download size={16} />
                    )}
                  </summary>
                  <div className="terms-download-options">
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      disabled={termsExporting}
                      onClick={(event) => {
                        event.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                        void handleTermsDownload("pdf");
                      }}
                    >
                      PDF
                    </button>
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      disabled={termsExporting}
                      onClick={(event) => {
                        event.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                        void handleTermsDownload("docx");
                      }}
                    >
                      Word (.doc)
                    </button>
                  </div>
                </details>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => {
                    setTermsOpen(false);
                    setOpen(true);
                    if (!pendingEmployeeId)
                      pendingEmployeeValues.current = null;
                    if (!pendingEmployeeId) setPendingEmployeeFormValues({});
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={!accepted || busy}
                  onClick={() => void createEmployee()}
                >
                  {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
                  {pendingEmployeeId
                    ? "Retry document upload"
                    : isOutletUser
                      ? "Accept & submit request"
                      : "Accept & add employee"}
                </button>
              </div>
            </div>

            {/* Baaki sab neeche scroll hoga */}
            <div className="terms-scroll" ref={termsScrollRef}>
              {/* ================= PAGE 1 ================= */}
              <article className="terms-paper" aria-label="Terms page 1">
                {termsLetterhead}
                <h3 className="terms-title">{EMPLOYEE_TERMS.title}</h3>
                <p className="terms-intro">
                  {EMPLOYEE_TERMS.introduction}
                  <br />
                  {EMPLOYEE_TERMS.introductionHindi}
                </p>
                <ol className="terms-rules">
                  {pageOneRules.map((rule, index) => (
                    <li key={index}>
                      <span className="terms-rule-en">
                        {fillToken(rule.en, "{salary}", salaryForTerms)}
                      </span>
                      <span className="terms-rule-hi">
                        {fillToken(rule.hi, "{salary}", salaryForTerms)}
                      </span>
                    </li>
                  ))}
                </ol>
                {termsLetterfoot}
              </article>

              {/* ================= PAGE 2 ================= */}
              <article
                className={`terms-paper${pageTwoRules.length === 0 ? " terms-paper-compact" : ""}`}
                aria-label="Terms page 2"
              >
                {termsLetterhead}
                {pageTwoRules.length > 0 && (
                <ol className="terms-rules" start={TERMS_PAGE_SPLIT + 1}>
                    {pageTwoRules.map((rule, index) => (
                      <li key={index}>
                        <span className="terms-rule-en">
                          {fillToken(rule.en, "{salary}", salaryForTerms)}
                        </span>
                        <span className="terms-rule-hi">
                          {fillToken(rule.hi, "{salary}", salaryForTerms)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}

                <section className="terms-declaration">
                  <h4>{EMPLOYEE_TERMS.declarationTitle}</h4>
                  <p>{fillToken(EMPLOYEE_TERMS.declarationEnglish, "{name}", termsEmployeeName)}</p>
                  <p>{fillToken(EMPLOYEE_TERMS.declarationHindi, "{name}", termsEmployeeName)}</p>
                  <p>
                    <strong>Date of Joining / शामिल होने की तिथि:</strong>{" "}
                    {formatDate(termsJoiningDate).replaceAll("-", " / ")}
                  </p>
                </section>

                <section className="terms-signatures">
                  <h4>{EMPLOYEE_TERMS.signaturesTitle}</h4>
                  <div className="terms-signature-grid">
                    {EMPLOYEE_TERMS.signatureFields.flat().map((label) => (
                      <div className="terms-signature-field" key={label}>
                        <span>{label}:</span>
                        {label === "Employee Signature" &&
                        signatureUpload?.preview ? (
                          <div className="terms-signature-line">
                            <Image
                              className="terms-signature-image"
                              src={signatureUpload.preview}
                              alt="Employee signature"
                              width={280}
                              height={72}
                              unoptimized
                            />
                            <i aria-hidden="true" />
                          </div>
                        ) : (
                          <i aria-hidden="true" />
                        )}
                      </div>
                    ))}
                  </div>
                </section>
                {termsLetterfoot}
              </article>
            </div>
          </section>
        </div>
      )}
      {previewUpload?.preview && (
        <div
          className="employee-upload-preview-backdrop"
          onClick={() => setPreviewUpload(null)}
        >
          <section
            className="employee-upload-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="employee-upload-preview-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="employee-upload-preview-header">
              <div>
                <h2 id="employee-upload-preview-title">
                  {previewUpload.file.name}
                </h2>
                <p>
                  {(previewUpload.file.size / (1024 * 1024)).toFixed(2)} MB
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close image preview"
                onClick={() => setPreviewUpload(null)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="employee-upload-preview-body">
              <Image
                src={previewUpload.preview}
                alt={`Preview of ${previewUpload.file.name}`}
                width={1600}
                height={1200}
                unoptimized
              />
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

// "{token}" ko value se replace karta hai (underline ke saath). Value khali ho to ________ dikhata hai.
function fillToken(template: string, token: string, value: string): ReactNode {
  const parts = template.split(token);
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 && (
            <u className="terms-fill">{value || "________"}</u>
          )}
        </Fragment>
      ))}
    </>
  );
}

function ageOnDate(birthDate: string, date: string) {
  const birth = new Date(`${birthDate}T00:00:00.000Z`);
  const joining = new Date(`${date}T00:00:00.000Z`);
  let age = joining.getUTCFullYear() - birth.getUTCFullYear();
  if (
    joining.getUTCMonth() < birth.getUTCMonth() ||
    (joining.getUTCMonth() === birth.getUTCMonth() &&
      joining.getUTCDate() < birth.getUTCDate())
  )
    age -= 1;
  return age;
}

function nullableString(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean || null;
}

function outletPrefix(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/gi, "")
    .slice(0, 3)
    .toUpperCase();
}

function documentTypeLabel(type: EmployeeDocumentType) {
  return {
    AADHAAR: "Aadhaar",
    PAN: "PAN card",
    BANK_PROOF: "Bank passbook / cheque",
    DRIVING_LICENCE: "Driving licence",
    PHOTO: "Passport-size photo",
    SIGNATURE: "Digital signature",
    OTHER: "Other",
  }[type];
}

function fieldError(errors: Record<string, string>, name: string) {
  const message = errors[name];
  return message ? <small className="field-error">{message}</small> : null;
}