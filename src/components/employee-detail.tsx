"use client";

import Link from "next/link";
import Image from "next/image";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { ArrowDownToLine, ArrowLeft, Check, Eye, EyeOff, FileText, LoaderCircle, Share2, Trash2, Upload, X } from "lucide-react";
import type { EmployeeView } from "@/lib/ui-types";
import { AutoDismissNotice } from "@/components/auto-dismiss-notice";
import {
  EMPLOYEE_DESIGNATIONS,
  getEmployeeDesignationGroup,
  isDeliveryRiderDesignation,
} from "@/lib/employee-designations";
import { getEmployeeCodePrefix } from "@/lib/employee-code";
import { UniformDetailsFields } from "@/components/uniform-details-fields";
import { uniformEntriesFromForm } from "@/lib/uniform-deductions";
import {
  EMPLOYEE_DOCUMENT_MAX_BYTES,
  EMPLOYEE_DOCUMENT_MIME_TYPES,
  EMPLOYEE_DOCUMENT_TYPES,
  type EmployeeDocumentType,
} from "@/lib/employee-documents-config";

type EmployeeFileView = {
  id: string;
  fileName: string;
  documentType: EmployeeDocumentType;
  fileType: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
};

type PendingFile = {
  file: File;
  documentType: EmployeeDocumentType;
  preview?: string;
};

type EmployeeDetailData = {
  employee: EmployeeView;
  outlets: Array<{ _id: string; code: string; name: string }>;
  documents: EmployeeFileView[];
};

const subscribeToNothing = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

const employeeDetailCache = new Map<
  string,
  { data: EmployeeDetailData; expiresAt: number }
>();
const employeeDetailRequests = new Map<string, Promise<EmployeeDetailData>>();
const employeeDetailEmployeeRequests = new Map<
  string,
  Promise<EmployeeView>
>();

async function readResponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? fallback);
  return body as T;
}

async function loadEmployeeDetailData(
  id: string,
  includeDocuments: boolean,
  cacheScope: string,
  onEmployeeLoaded?: (employee: EmployeeView) => void,
): Promise<EmployeeDetailData> {
  const cacheKey = `${cacheScope}:${id}:${includeDocuments}`;
  const cached = employeeDetailCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    onEmployeeLoaded?.(cached.data.employee);
    return cached.data;
  }
  const pending = employeeDetailRequests.get(cacheKey);
  if (pending) {
    const employeeRequest = employeeDetailEmployeeRequests.get(cacheKey);
    if (onEmployeeLoaded) {
      if (employeeRequest)
        void employeeRequest.then(onEmployeeLoaded, () => undefined);
      else
        void pending.then(
          (data) => onEmployeeLoaded(data.employee),
          () => undefined,
        );
    }
    return pending;
  }

  const employeeRequest = fetch(`/api/employees/${id}`, {
    cache: "no-store",
  }).then((response) =>
    readResponse<{ employee: EmployeeView }>(
      response,
      "Unable to load employee.",
    ).then(({ employee }) => {
      onEmployeeLoaded?.(employee);
      return employee;
    }),
  );
  employeeDetailEmployeeRequests.set(cacheKey, employeeRequest);
  const request = Promise.all([
    employeeRequest,
    fetch("/api/outlets", { cache: "no-store" }).then((response) =>
      readResponse<{ outlets: EmployeeDetailData["outlets"] }>(
        response,
        "Unable to load outlets.",
      ),
    ),
    includeDocuments
      ? fetch(`/api/employees/${id}/documents`, { cache: "no-store" }).then(
          (response) =>
            readResponse<{ documents: EmployeeFileView[] }>(
              response,
              "Unable to load employee documents.",
            ),
        )
      : Promise.resolve({ documents: [] as EmployeeFileView[] }),
  ]).then(([employeeResult, outletResult, documentResult]) => {
    const data = {
      employee: employeeResult,
      outlets: outletResult.outlets,
      documents: documentResult.documents,
    };
    employeeDetailCache.set(cacheKey, {
      data,
      expiresAt: Date.now() + 30_000,
    });
    return data;
  });
  employeeDetailRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (employeeDetailRequests.get(cacheKey) === request)
      employeeDetailRequests.delete(cacheKey);
    if (employeeDetailEmployeeRequests.get(cacheKey) === employeeRequest)
      employeeDetailEmployeeRequests.delete(cacheKey);
  }
}

export function prefetchEmployeeDetail(
  id: string,
  includeDocuments: boolean,
  cacheScope: string,
) {
  void loadEmployeeDetailData(id, includeDocuments, cacheScope).catch(
    () => undefined,
  );
}

function clearEmployeeDetailPrefetch(id: string, cacheScope: string) {
  for (const key of employeeDetailCache.keys())
    if (key.startsWith(`${cacheScope}:${id}:`)) employeeDetailCache.delete(key);
  for (const key of employeeDetailEmployeeRequests.keys())
    if (key.startsWith(`${cacheScope}:${id}:`))
      employeeDetailEmployeeRequests.delete(key);
}

export function EmployeeDetail({
  id,
  cacheScope,
  canEdit,
  mainAdmin,
  canViewSensitive,
  canManageUniforms,
  modal = false,
  onSaved,
}: {
  id: string;
  cacheScope: string;
  canEdit: boolean;
  mainAdmin: boolean;
  canViewSensitive: boolean;
  canManageUniforms: boolean;
  modal?: boolean;
  onSaved?: (documentStorageWarning?: string) => void;
}) {
  const [employee, setEmployee] = useState<EmployeeView | null>(null);
  const [outlets, setOutlets] = useState<
    Array<{ _id: string; code: string; name: string }>
  >([]);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [outletId, setOutletId] = useState("");
  const [designationKey, setDesignationKey] = useState("");
  const [designationLabel, setDesignationLabel] = useState("");
  const [showSensitive, setShowSensitive] = useState(false);
  const [documents, setDocuments] = useState<EmployeeFileView[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [documentsBusy, setDocumentsBusy] = useState(false);
  const [uploadingDocuments, setUploadingDocuments] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadValidationError, setUploadValidationError] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const [previewDocument, setPreviewDocument] = useState<EmployeeFileView | null>(
    null,
  );
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewContentUrl, setPreviewContentUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const portalReady = useSyncExternalStore(
    subscribeToNothing,
    getClientSnapshot,
    getServerSnapshot,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedOutlet = outlets.find((outlet) => outlet._id === outletId);
  const designationGroup = getEmployeeDesignationGroup(selectedOutlet?.code ?? "");
  const availableDesignations = EMPLOYEE_DESIGNATIONS.filter(
    (item) => item.group === designationGroup,
  );

  useEffect(() => {
    let active = true;
    void loadEmployeeDetailData(id, canViewSensitive, cacheScope, (loaded) => {
      if (!active) return;
      setEmployee(loaded);
      setOutletId(loaded.outletId);
      setDesignationKey(
        EMPLOYEE_DESIGNATIONS.some((item) => item.key === loaded.designationKey)
          ? loaded.designationKey ?? "LEGACY"
          : "LEGACY",
      );
      setDesignationLabel(loaded.designation ?? "");
    })
      .then((data) => {
        if (!active) return;
        setOutlets(data.outlets);
        setDocuments(data.documents);
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load employee.",
          );
      });
    return () => {
      active = false;
    };
  }, [id, canViewSensitive, cacheScope]);

  function openPreview(file: EmployeeFileView) {
    setPreviewUrl("");
    setPreviewContentUrl(`/api/employee-documents/${file.id}?preview=1`);
    setPreviewError("");
    setShareMessage("");
    setPreviewLoading(
      file.fileType.startsWith("image/") ||
        file.fileType === "application/pdf",
    );
    setPreviewDocument(file);
  }

  useEffect(() => {
    if (!previewDocument) return;
    const controller = new AbortController();
    void fetch(`/api/employee-documents/${previewDocument.id}?signed=1`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) =>
        readResponse<{ url: string }>(
          response,
          "Unable to prepare the document preview.",
        ),
      )
      .then(({ url }) => {
        if (!url) throw new Error("The document preview link is unavailable.");
        if (controller.signal.aborted) return;
        setPreviewUrl(url);
        if (
          !previewDocument.fileType.startsWith("image/") &&
          previewDocument.fileType !== "application/pdf"
        )
          setPreviewLoading(false);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setShareMessage(
            caught instanceof Error
              ? caught.message
              : "Unable to prepare the secure share link.",
          );
        }
      });
    return () => controller.abort();
  }, [previewDocument]);

  useEffect(() => {
    if (!previewDocument) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPreviewDocument(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewDocument]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employee) return;
    const values = new FormData(event.currentTarget);
    const input: Record<string, unknown> = {
      employeeCode: values.get("employeeCode"),
      fullName: values.get("fullName"),
      dateOfJoining: values.get("dateOfJoining"),
      designation: designationLabel,
      designationKey:
        designationKey && designationKey !== "LEGACY" ? designationKey : null,
      designationGroup: designationKey && designationKey !== "LEGACY"
        ? availableDesignations.find((item) => item.key === designationKey)?.group
        : designationGroup,
      employmentType: values.get("employmentType"),
      mobile: values.get("mobile"),
      outletId,
    };
    if (canViewSensitive)
      Object.assign(input, {
        dateOfBirth: nullable(values.get("dateOfBirth")),
        gender: nullable(values.get("gender")),
        beneficiaryName: nullable(values.get("beneficiaryName")),
        bankName: nullable(values.get("bankName")),
        branchName: nullable(values.get("branchName")),
        accountNumber: nullable(values.get("accountNumber")),
        ifscCode: nullable(values.get("ifscCode")),
        panNumber: nullable(values.get("panNumber")),
        aadhaarNumber: nullable(values.get("aadhaarNumber")),
        drivingLicenceNumber: nullable(values.get("drivingLicenceNumber")),
      });
    if (mainAdmin)
      Object.assign(input, {
        monthlyBaseSalary: Number(values.get("monthlyBaseSalary")),
        salaryMethod: values.get("salaryMethod"),
        pfEnabled: values.get("pfEnabled") === "true",
        employeePfPercent: Number(values.get("employeePfPercent")),
        employerPfPercent: Number(values.get("employerPfPercent")),
        esiEnabled: values.get("esiEnabled") === "true",
        esiPercent: Number(values.get("esiPercent")),
        notes: values.get("notes"),
      });
    if (canManageUniforms)
      input.uniformDeductions = uniformEntriesFromForm(values);
    setBusy(true);
    setError("");
    setFieldErrors({});
    setSuccess("");
    try {
      const response = await fetch(`/api/employees/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok) {
        if (Array.isArray(result.details))
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
        if (
          typeof result.error === "string" &&
          result.error.toLowerCase().includes("driving licence")
        )
          setFieldErrors((current) => ({
            ...current,
            drivingLicenceNumber: result.error,
          }));
        throw new Error(result.error ?? "Unable to save employee.");
      }
      const documentStorageWarning =
        typeof result.documentStorageWarning === "string"
          ? result.documentStorageWarning
          : undefined;
      clearEmployeeDetailPrefetch(id, cacheScope);
      setSuccess(
        documentStorageWarning ?? "Employee details saved.",
      );
      setEmployee((current) =>
        current
          ? ({
              ...current,
              ...input,
              designation: designationLabel,
              designationKey:
                designationKey && designationKey !== "LEGACY"
                  ? designationKey
                  : null,
              outletId,
              monthlyBaseSalary: mainAdmin
                ? Number(input.monthlyBaseSalary)
                : current.monthlyBaseSalary,
            } as EmployeeView)
          : current,
      );
      onSaved?.(documentStorageWarning);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to save employee.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function generateCode() {
    const targetOutletId = outletId || employee?.outletId;
    if (!targetOutletId) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/employees?nextCode=true&outletId=${encodeURIComponent(targetOutletId)}&employeeId=${encodeURIComponent(id)}`,
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Unable to generate employee code.");
      const codeInput = formRef.current?.elements.namedItem("employeeCode");
      if (codeInput instanceof HTMLInputElement)
        codeInput.value = result.employeeCode;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to generate employee code.",
      );
    } finally {
      setBusy(false);
    }
  }

  function addFiles(files: FileList | File[]) {
    const additions: PendingFile[] = [];
    setUploadValidationError("");
    for (const file of Array.from(files)) {
      const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      if (
        !(extension in EMPLOYEE_DOCUMENT_MIME_TYPES) ||
        file.type !==
          EMPLOYEE_DOCUMENT_MIME_TYPES[
            extension as keyof typeof EMPLOYEE_DOCUMENT_MIME_TYPES
          ]
      ) {
        setUploadValidationError(
          `${file.name}: only JPG, JPEG, PNG, WEBP, PDF, and DOCX files are allowed.`,
        );
        continue;
      }
      if (!file.size || file.size > EMPLOYEE_DOCUMENT_MAX_BYTES) {
        setUploadValidationError(
          `${file.name}: file must be between 1 byte and ${Math.floor(EMPLOYEE_DOCUMENT_MAX_BYTES / (1024 * 1024))} MB.`,
        );
        continue;
      }
      const pending: PendingFile = { file, documentType: "OTHER" };
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string")
            setPendingFiles((current) =>
              current.map((item) =>
                item === pending ? { ...item, preview: reader.result as string } : item,
              ),
            );
        };
        reader.readAsDataURL(file);
      }
      additions.push(pending);
    }
    setPendingFiles((current) => [...current, ...additions]);
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    addFiles(event.target.files ?? []);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDropActive(false);
    addFiles(event.dataTransfer.files);
  }

  async function uploadDocuments() {
    if (!pendingFiles.length) return;
    setDocumentsBusy(true);
    setUploadingDocuments(true);
    setUploadProgress(0);
    setError("");
    setUploadValidationError("");
    try {
      const form = new FormData();
      for (const item of pendingFiles) {
        form.append("files", item.file);
        form.append("documentTypes", item.documentType);
      }
      const result = await new Promise<{ documents: EmployeeFileView[] }>(
        (resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", `/api/employees/${id}/documents`);
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable)
              setUploadProgress(
                Math.round((event.loaded / event.total) * 100),
              );
          };
          xhr.onload = () => {
            let payload: {
              error?: string;
              documents?: EmployeeFileView[];
            };
            try {
              payload = JSON.parse(xhr.responseText);
            } catch {
              reject(new Error("The server returned an invalid upload response."));
              return;
            }
            if (xhr.status < 200 || xhr.status >= 300 || !payload.documents) {
              reject(
                new Error(
                  payload.error ?? "Unable to upload employee documents.",
                ),
              );
              return;
            }
            setUploadProgress(100);
            resolve({ documents: payload.documents });
          };
          xhr.onerror = () =>
            reject(new Error("Network error while uploading documents."));
          xhr.onabort = () =>
            reject(new Error("The document upload was interrupted."));
          xhr.send(form);
        },
      );
      setDocuments((current) => [...result.documents, ...current]);
      setPendingFiles([]);
      clearEmployeeDetailPrefetch(id, cacheScope);
      setSuccess("Employee documents uploaded.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to upload employee documents.",
      );
    } finally {
      setUploadingDocuments(false);
      setDocumentsBusy(false);
    }
  }

  async function deleteDocument(document: EmployeeFileView) {
    if (!window.confirm(`Delete ${documentTypeLabel(document.documentType)}?`)) return;
    setDocumentsBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/employees/${id}/documents?documentId=${encodeURIComponent(document.id)}`,
        { method: "DELETE" },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Unable to delete employee document.");
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      clearEmployeeDetailPrefetch(id, cacheScope);
      setSuccess("Employee document deleted.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to delete employee document.",
      );
    } finally {
      setDocumentsBusy(false);
    }
  }

  async function downloadDocument(file: EmployeeFileView) {
    setError("");
    try {
      const response = await fetch(
        `/api/employee-documents/${file.id}?download=1`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error ?? "Unable to download employee document.");
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error("The downloaded document is empty.");
      const link = document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
      link.download = file.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setShareMessage("Download started.");
    } catch (caught) {
      setShareMessage(
        caught instanceof Error
          ? caught.message
          : "Unable to download employee document.",
      );
    }
  }

  async function sharePreview() {
    if (!previewDocument || !previewUrl) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: previewDocument.fileName,
          url: previewUrl,
        });
      } else {
        await navigator.clipboard.writeText(previewUrl);
        setShareMessage("Link copied.");
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError")
        return;
      setShareMessage(
        caught instanceof Error ? caught.message : "Unable to share this link.",
      );
    }
  }

  if (!employee)
    return (
      <main
        className={`content-area${modal ? " employee-detail-modal-content" : ""}`}
      >
        {!modal && (
          <Link className="back-link" href="/employees">
            <ArrowLeft size={16} /> Employees
          </Link>
        )}
        {error ? (
          <AutoDismissNotice
            key={`error:${error}`}
            message={error}
            variant="error"
          />
        ) : (
          <div
            className="employee-edit-skeleton"
            role="status"
            aria-label="Loading employee details"
            aria-busy="true"
          >
            <div className="employee-edit-skeleton-message">
              <LoaderCircle className="spin" size={18} />
              Loading employee details…
            </div>
            <div className="employee-edit-skeleton-grid" aria-hidden="true">
              {Array.from({ length: 8 }, (_, index) => (
                <i className="workspace-skeleton-block" key={index} />
              ))}
            </div>
          </div>
        )}
      </main>
    );

  const sensitiveFields: Array<{
    name: string;
    label: string;
    value: string | null | undefined;
  }> = [
    { name: "beneficiaryName", label: "Beneficiary name", value: employee.beneficiaryName },
    { name: "bankName", label: "Bank name", value: employee.bankName },
    { name: "branchName", label: "Branch name", value: employee.branchName },
    { name: "accountNumber", label: "Account number", value: employee.accountNumber },
    { name: "ifscCode", label: "IFSC code", value: employee.ifscCode },
    { name: "panNumber", label: "PAN number", value: employee.panNumber },
    { name: "aadhaarNumber", label: "Aadhaar number", value: employee.aadhaarNumber },
    {
      name: "drivingLicenceNumber",
      label: "Driving licence number",
      value: employee.drivingLicenceNumber,
    },
  ];

  return (
    <main
      className={`content-area employee-detail-page${modal ? " employee-detail-modal-content" : ""}`}
    >
      {!modal && (
        <>
          <Link className="back-link" href="/employees">
            <ArrowLeft size={16} /> Employees
          </Link>
          <div className="page-head">
            <div>
              <div className="eyebrow">
                EMPLOYEE RECORD / {employee.employeeCode}
              </div>
              <h1>{employee.fullName}</h1>
              <p>
                {employee.designation} · {employee.active ? "Active" : "Inactive"}
              </p>
            </div>
            <span
              className={`badge ${employee.active ? "badge-green" : "badge-muted"}`}
            >
              {employee.active ? "Active employee" : "Historical record"}
            </span>
            {(employee.licencePending ??
              (isDeliveryRiderDesignation(employee) &&
                !employee.drivingLicenceNumber)) && (
              <span className="badge badge-amber">Licence pending</span>
            )}
          </div>
        </>
      )}
      {error && (
        <AutoDismissNotice
          key={`error:${error}`}
          message={error}
          variant="error"
        />
      )}
      {success && (
        <AutoDismissNotice
          key={`success:${success}`}
          message={success}
          variant="success"
        />
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Employee details</h2>
            <p>Edits are scoped to your assigned outlet.</p>
          </div>
        </div>
        <form
          ref={formRef}
          className="form-grid detail-form"
          onSubmit={save}
          onChange={(event) => {
            const target = event.target;
            if (
              target instanceof HTMLInputElement ||
              target instanceof HTMLSelectElement
            ) {
              setFieldErrors((current) => {
                if (!(target.name in current)) return current;
                const next = { ...current };
                delete next[target.name];
                return next;
              });
              setError("");
            }
          }}
        >
          <label className="field">
            <span>Employee code</span>
            <div className="employee-code-input">
              <input
                name="employeeCode"
                defaultValue={employee.employeeCode}
                pattern={`${employeeCodePrefix(selectedOutlet?.name ?? "")}[0-9]{4}`}
                maxLength={7}
                required
                disabled={!canEdit}
              />
              {canEdit && (
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
            {fieldErrorMessage(fieldErrors, "employeeCode")}
          </label>
          <label className="field">
            <span>Full name</span>
            <input
              name="fullName"
              defaultValue={employee.fullName}
              required
              disabled={!canEdit}
            />
            {fieldErrorMessage(fieldErrors, "fullName")}
          </label>
          <label className="field">
            <span>Date of joining</span>
            <input
              name="dateOfJoining"
              type="date"
              defaultValue={employee.dateOfJoining}
              required
              disabled={!canEdit}
            />
            {fieldErrorMessage(fieldErrors, "dateOfJoining")}
          </label>
          <label className="field">
            <span>Designation</span>
            <select
              name="designationKey"
              value={designationKey}
              onChange={(event) => {
                setDesignationKey(event.target.value);
                if (event.target.value === "LEGACY") {
                  setDesignationLabel(employee.designation);
                  return;
                }
                setDesignationLabel(
                  availableDesignations.find(
                    (item) => item.key === event.target.value,
                  )?.label ?? "",
                );
              }}
              required
              disabled={!canEdit}
            >
              <option value="">Select designation</option>
              {designationKey === "LEGACY" && (
                <option value="LEGACY">Legacy: {employee.designation}</option>
              )}
              {availableDesignations.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
            <small>{designationLabel}</small>
            {fieldErrorMessage(fieldErrors, "designationKey")}
            {fieldErrorMessage(fieldErrors, "designation")}
          </label>
          <label className="field">
            <span>Employment type</span>
            <select
              name="employmentType"
              defaultValue={employee.employmentType ?? "FULL_TIME"}
              disabled={!canEdit}
            >
              <option value="FULL_TIME">Full-time</option>
              <option value="PART_TIME">Part-time</option>
            </select>
          </label>
          <label className="field">
            <span>Mobile</span>
            <input
              name="mobile"
              defaultValue={employee.mobile ?? ""}
              required
              disabled={!canEdit || !canViewSensitive}
            />
            {fieldErrorMessage(fieldErrors, "mobile")}
          </label>
          <label className="field">
            <span>Outlet</span>
            <select
              name="outletId"
              value={outletId}
              onChange={(event) => {
                const nextOutlet = outlets.find(
                  (item) => item._id === event.target.value,
                );
                const nextGroup = getEmployeeDesignationGroup(
                  nextOutlet?.code ?? "",
                );
                setOutletId(event.target.value);
                if (nextGroup !== designationGroup) {
                  setDesignationKey("");
                  setDesignationLabel("");
                }
              }}
              disabled={!canEdit || !mainAdmin}
            >
              {outlets.map((outlet) => (
                <option key={outlet._id} value={outlet._id}>
                  {outlet.code} · {outlet.name}
                </option>
              ))}
            </select>
          </label>
          {canViewSensitive && (
            <>
              <div className="employee-sensitive-heading">
                <h3>Personal and identity details</h3>
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={() => setShowSensitive((current) => !current)}
                  aria-pressed={showSensitive}
                >
                  {showSensitive ? <EyeOff size={14} /> : <Eye size={14} />}
                  {showSensitive ? "Mask sensitive values" : "Reveal sensitive values"}
                </button>
              </div>
              <label className="field">
                <span>Date of birth</span>
                <input
                  name="dateOfBirth"
                  type="date"
                  defaultValue={employee.dateOfBirth ?? ""}
                  disabled={!canEdit}
                />
                {fieldErrorMessage(fieldErrors, "dateOfBirth")}
              </label>
              <label className="field">
                <span>Gender</span>
                <select
                  name="gender"
                  defaultValue={employee.gender ?? ""}
                  disabled={!canEdit}
                >
                  <option value="">Not specified</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                </select>
              </label>
              {sensitiveFields.map(({ name, label, value }) => (
                <label className="field" key={name}>
                  <span>{label}</span>
                  <input
                    name={name}
                    type={showSensitive ? "text" : "password"}
                    autoComplete="off"
                    defaultValue={value ?? ""}
                    disabled={!canEdit}
                    inputMode={
                      name === "aadhaarNumber" || name === "accountNumber"
                        ? "numeric"
                        : undefined
                    }
                    pattern={
                      name === "accountNumber"
                        ? "[0-9]{9,18}"
                        : name === "ifscCode"
                          ? "[A-Za-z]{4}0[A-Za-z0-9]{6}"
                          : name === "panNumber"
                            ? "[A-Za-z]{5}[0-9]{4}[A-Za-z]"
                            : name === "aadhaarNumber"
                              ? "[0-9]{12}"
                              : undefined
                    }
                    required={
                      name === "drivingLicenceNumber" &&
                      isDeliveryRiderDesignation({
                        designationKey:
                          designationKey === "LEGACY" ? null : designationKey,
                        designation: designationLabel,
                      })
                    }
                  />
                  {fieldErrorMessage(fieldErrors, name)}
                </label>
              ))}
            </>
          )}
          {mainAdmin && (
            <>
              <label className="field">
                <span>Monthly base salary (INR)</span>
                <input
                  name="monthlyBaseSalary"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={employee.monthlyBaseSalary}
                  required
                  disabled={!canEdit}
                />
                {fieldErrorMessage(fieldErrors, "monthlyBaseSalary")}
              </label>
              <input
                type="hidden"
                name="salaryMethod"
                value="FIXED_30_DAYS"
              />
              <div className="field">
                <span>Salary calculation</span>
                <p className="policy-note">
                  Fixed 30-day basis: monthly base salary ÷ 30.
                </p>
              </div>
              <label className="field">
                <span>PF enabled</span>
                <select
                  name="pfEnabled"
                  defaultValue={String(employee.pfEnabled)}
                  disabled={!canEdit}
                >
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </label>
              <label className="field">
                <span>Employee PF %</span>
                <input
                  name="employeePfPercent"
                  type="number"
                  min="0"
                  max="100"
                  defaultValue={employee.employeePfPercent}
                  required
                  disabled={!canEdit}
                />
                {fieldErrorMessage(fieldErrors, "employeePfPercent")}
              </label>
              <label className="field">
                <span>Employer PF %</span>
                <input
                  name="employerPfPercent"
                  type="number"
                  min="0"
                  max="100"
                  defaultValue={employee.employerPfPercent}
                  required
                  disabled={!canEdit}
                />
                {fieldErrorMessage(fieldErrors, "employerPfPercent")}
              </label>
              <label className="field">
                <span>ESI enabled</span>
                <select
                  name="esiEnabled"
                  defaultValue={String(employee.esiEnabled ?? false)}
                  disabled={!canEdit}
                >
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </label>
              <label className="field">
                <span>Employee ESI %</span>
                <input
                  name="esiPercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue={employee.esiPercent ?? 0.75}
                  required
                  disabled={!canEdit}
                />
                {fieldErrorMessage(fieldErrors, "esiPercent")}
              </label>
              <label className="field">
                <span>Notes</span>
                <input name="notes" defaultValue={employee.notes ?? ""} disabled={!canEdit} />
              </label>
            </>
          )}
          {canManageUniforms && (
            <UniformDetailsFields disabled={!canEdit} />
          )}
          {canEdit && (
            <div className="form-actions">
              <button className="button button-primary" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Check size={16} />
                )}{" "}
                Save employee
              </button>
            </div>
          )}
        </form>
      </section>
      {canViewSensitive && (
        <section className="panel employee-documents-panel">
          <div className="panel-heading">
            <div>
              <h2>Private documents</h2>
              <p>Files are available only to authorized head-office users.</p>
            </div>
          </div>
          {canEdit && (
            <div className="employee-documents-upload">
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
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  className="employee-document-input"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf,.docx"
                  multiple
                  onChange={selectFiles}
                />
                <Upload size={23} aria-hidden="true" />
                <strong>Drag &amp; drop files here or click to browse</strong>
                <span>JPG, PNG, WEBP, PDF, DOCX · up to 10 MB per file</span>
              </div>
              {uploadValidationError && (
                <p className="employee-upload-error" role="alert">
                  {uploadValidationError}
                </p>
              )}
              {pendingFiles.map((item, index) => (
                <div className="employee-upload-item" key={`${item.file.name}-${item.file.size}-${index}`}>
                  {item.preview ? (
                    <Image
                      className="employee-file-preview"
                      src={item.preview}
                      alt=""
                      width={48}
                      height={48}
                      unoptimized
                    />
                  ) : (
                    <FileText size={17} />
                  )}
                  <span>
                    {item.file.name} · {formatFileSize(item.file.size)}
                  </span>
                  <select
                    aria-label={`Document type for ${item.file.name}`}
                    value={item.documentType}
                    onChange={(event) =>
                      setPendingFiles((current) =>
                        current.map((file, fileIndex) =>
                          fileIndex === index
                            ? { ...file, documentType: event.target.value as EmployeeDocumentType }
                            : file,
                        ),
                      )
                    }
                  >
                    {EMPLOYEE_DOCUMENT_TYPES.map((type) => (
                      <option key={type} value={type}>{documentTypeLabel(type)}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={documentsBusy}
                    aria-label={`Remove ${item.file.name}`}
                    onClick={() =>
                      setPendingFiles((current) =>
                        current.filter((_, fileIndex) => fileIndex !== index),
                      )
                    }
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
              {uploadingDocuments && (
                <div className="employee-upload-progress">
                  <div
                    className="employee-upload-progress-track"
                    role="progressbar"
                    aria-label="Document upload progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={uploadProgress}
                  >
                    <span style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <small>{uploadProgress}% uploaded</small>
                </div>
              )}
              {pendingFiles.length > 0 && (
                <button
                  className="button button-primary"
                  type="button"
                  disabled={documentsBusy}
                  onClick={() => void uploadDocuments()}
                >
                  {documentsBusy ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}
                  {uploadingDocuments
                    ? `Uploading ${uploadProgress}%`
                    : "Upload selected documents"}
                </button>
              )}
            </div>
          )}
          {documents.length ? (
            <div className="employee-document-list">
              {documents.map((document) => (
                <article className="employee-document-row" key={document.id}>
                  <button
                    type="button"
                    className="employee-document-open-icon"
                    aria-label={`Preview ${document.fileName}`}
                    onClick={() => openPreview(document)}
                  >
                    <FileText size={17} />
                  </button>
                  <div>
                    <button
                      type="button"
                      className="employee-document-name"
                      onClick={() => openPreview(document)}
                    >
                      {document.fileName}
                    </button>
                    <small>
                      {documentTypeLabel(document.documentType)} · {document.fileType} ·{" "}
                      {formatFileSize(document.size)} ·{" "}
                      {new Date(document.uploadedAt).toLocaleDateString()}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    onClick={() => openPreview(document)}
                  >
                    Preview
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Delete ${documentTypeLabel(document.documentType)}`}
                      disabled={documentsBusy}
                      onClick={() => void deleteDocument(document)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state"><strong>No documents uploaded.</strong></div>
          )}
        </section>
      )}
      {previewDocument &&
        portalReady &&
        createPortal(
          <div
            className="employee-document-preview-backdrop"
            onClick={(event) => {
              if (event.target === event.currentTarget)
                setPreviewDocument(null);
            }}
          >
            <section
              className="employee-document-preview"
              role="dialog"
              aria-modal="true"
              aria-labelledby="employee-document-preview-title"
            >
              <header className="employee-document-preview-header">
                <div>
                  <h2 id="employee-document-preview-title">
                    {previewDocument.fileName}
                  </h2>
                  <p>
                    {previewDocument.fileType} · {formatFileSize(previewDocument.size)} ·{" "}
                    {new Date(previewDocument.uploadedAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close document preview"
                  onClick={() => setPreviewDocument(null)}
                >
                  <X size={18} />
                </button>
              </header>
              <div className="employee-document-preview-body">
                {previewLoading && (
                  <div className="employee-document-preview-message" role="status">
                    <LoaderCircle className="spin" size={20} />
                    Preparing secure preview…
                  </div>
                )}
                {previewError ? (
                  <div className="employee-document-preview-message" role="alert">
                    <FileText size={30} />
                    <span>{previewError}</span>
                  </div>
                ) : previewContentUrl &&
                  previewDocument.fileType.startsWith("image/") ? (
                  <Image
                    className="employee-document-preview-image"
                    src={previewContentUrl}
                    alt={previewDocument.fileName}
                    width={1600}
                    height={1200}
                    unoptimized
                    onLoad={() => setPreviewLoading(false)}
                    onError={() => {
                      setPreviewLoading(false);
                      setPreviewError("This image could not be displayed.");
                    }}
                  />
                ) : previewContentUrl &&
                  previewDocument.fileType === "application/pdf" ? (
                  <iframe
                    className="employee-document-preview-pdf"
                    src={previewContentUrl}
                    title={`Preview of ${previewDocument.fileName}`}
                    onLoad={() => setPreviewLoading(false)}
                  />
                ) : (
                  <div className="employee-document-preview-message">
                    <FileText size={38} />
                    <strong>{previewDocument.fileName}</strong>
                    <span>{previewDocument.fileType}</span>
                    <span>Download this file to view it.</span>
                  </div>
                )}
              </div>
              <footer className="employee-document-preview-footer">
                <span role="status">{shareMessage}</span>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => void sharePreview()}
                  disabled={!previewUrl}
                >
                  <Share2 size={15} /> Share
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void downloadDocument(previewDocument)}
                >
                  <ArrowDownToLine size={15} /> Download
                </button>
              </footer>
            </section>
          </div>,
          document.body,
        )}
      {!modal && mainAdmin && employee.monthlyBaseSalary !== undefined && (
        <section className="panel detail-salary">
          <span>Monthly base salary</span>
          <strong>
            {new Intl.NumberFormat("en-IN", {
              style: "currency",
              currency: "INR",
            }).format(employee.monthlyBaseSalary)}
          </strong>
          <span>
            {employee.pfEnabled ? "PF enabled" : "PF not enabled"}
            {" · "}
            {employee.esiEnabled
              ? `ESI enabled · ${employee.esiPercent ?? 0.75}%`
              : "ESI not enabled"}
          </span>
        </section>
      )}
    </main>
  );
}

function nullable(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean || null;
}

function employeeCodePrefix(outletName: string) {
  return getEmployeeCodePrefix(outletName);
}

function documentTypeLabel(type: EmployeeDocumentType) {
  return {
    AADHAAR: "Aadhaar",
    PAN: "PAN",
    BANK_PROOF: "Bank passbook / cheque",
    DRIVING_LICENCE: "Driving licence",
    PHOTO: "Photo",
    OTHER: "Other",
  }[type];
}

function formatFileSize(size: number) {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function fieldErrorMessage(errors: Record<string, string>, name: string) {
  const message = errors[name];
  return message ? <small className="field-error">{message}</small> : null;
}
