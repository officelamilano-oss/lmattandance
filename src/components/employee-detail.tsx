"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowDownToLine, ArrowLeft, Check, Eye, EyeOff, FileText, LoaderCircle, Trash2, Upload } from "lucide-react";
import type { EmployeeView } from "@/lib/ui-types";
import { AutoDismissNotice } from "@/components/auto-dismiss-notice";
import {
  EMPLOYEE_DESIGNATIONS,
  getEmployeeDesignationGroup,
  isDeliveryRiderDesignation,
} from "@/lib/employee-designations";
import { getEmployeeCodePrefix } from "@/lib/employee-code";
import {
  EMPLOYEE_DOCUMENT_MAX_BYTES,
  EMPLOYEE_DOCUMENT_MIME_TYPES,
  EMPLOYEE_DOCUMENT_TYPES,
  type EmployeeDocumentType,
} from "@/lib/employee-documents-config";

type EmployeeFileView = {
  id: string;
  documentType: EmployeeDocumentType;
  mimeType: string;
  size: number;
  uploadedAt: string;
  url: string;
};

type PendingFile = {
  file: File;
  documentType: EmployeeDocumentType;
  preview?: string;
};

export function EmployeeDetail({
  id,
  canEdit,
  mainAdmin,
  canViewSensitive,
}: {
  id: string;
  canEdit: boolean;
  mainAdmin: boolean;
  canViewSensitive: boolean;
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
  const formRef = useRef<HTMLFormElement>(null);
  const selectedOutlet = outlets.find((outlet) => outlet._id === outletId);
  const designationGroup = getEmployeeDesignationGroup(selectedOutlet?.code ?? "");
  const availableDesignations = EMPLOYEE_DESIGNATIONS.filter(
    (item) => item.group === designationGroup,
  );

  useEffect(() => {
    void Promise.all([
      fetch(`/api/employees/${id}`).then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? "Unable to load employee.");
        setEmployee(body.employee);
        setOutletId(body.employee.outletId);
        setDesignationKey(
          EMPLOYEE_DESIGNATIONS.some(
            (item) => item.key === body.employee.designationKey,
          )
            ? body.employee.designationKey
            : "LEGACY",
        );
        setDesignationLabel(body.employee.designation);
      }),
      fetch("/api/outlets").then(async (response) => {
        if (response.ok) setOutlets((await response.json()).outlets);
      }),
      ...(canViewSensitive
        ? [
            fetch(`/api/employees/${id}/documents`).then(async (response) => {
              const body = await response.json();
              if (!response.ok)
                throw new Error(body.error ?? "Unable to load employee documents.");
              setDocuments(body.documents);
            }),
          ]
        : []),
    ]).catch((caught) =>
      setError(
        caught instanceof Error ? caught.message : "Unable to load employee.",
      ),
    );
  }, [id, canViewSensitive]);

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
      setSuccess("Employee details saved.");
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

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const additions: PendingFile[] = [];
    for (const file of Array.from(event.target.files ?? [])) {
      const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      if (
        !(extension in EMPLOYEE_DOCUMENT_MIME_TYPES) ||
        file.type !==
          EMPLOYEE_DOCUMENT_MIME_TYPES[
            extension as keyof typeof EMPLOYEE_DOCUMENT_MIME_TYPES
          ]
      ) {
        setError(`${file.name}: only JPG, PNG, WEBP, and PDF files are allowed.`);
        continue;
      }
      if (!file.size || file.size > EMPLOYEE_DOCUMENT_MAX_BYTES) {
        setError(`${file.name}: file must be between 1 byte and 5 MB.`);
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
    event.target.value = "";
  }

  async function uploadDocuments() {
    if (!pendingFiles.length) return;
    setDocumentsBusy(true);
    setError("");
    try {
      const form = new FormData();
      for (const item of pendingFiles) {
        form.append("files", item.file);
        form.append("documentTypes", item.documentType);
      }
      const response = await fetch(`/api/employees/${id}/documents`, {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Unable to upload employee documents.");
      setDocuments((current) => [...result.documents, ...current]);
      setPendingFiles([]);
      setSuccess("Employee documents uploaded.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to upload employee documents.",
      );
    } finally {
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
      setSuccess("Employee document deleted.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to delete employee document.",
      );
    } finally {
      setDocumentsBusy(false);
    }
  }

  if (!employee)
    return (
      <main className="content-area">
        <Link className="back-link" href="/employees">
          <ArrowLeft size={16} /> Employees
        </Link>
        {error ? (
          <AutoDismissNotice
            key={`error:${error}`}
            message={error}
            variant="error"
          />
        ) : (
          <div className="loading-state">
            <LoaderCircle className="spin" size={20} />
            Loading employee
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
    <main className="content-area employee-detail-page">
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
              defaultValue={employee.mobile}
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
              <label className="field">
                <span>Upload JPG, PNG, WEBP or PDF files (up to 5 MB each)</span>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  multiple
                  onChange={selectFiles}
                />
              </label>
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
                  <span>{item.file.name}</span>
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
                    aria-label={`Remove ${item.file.name}`}
                    onClick={() =>
                      setPendingFiles((current) =>
                        current.filter((_, fileIndex) => fileIndex !== index),
                      )
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              {pendingFiles.length > 0 && (
                <button
                  className="button button-primary"
                  type="button"
                  disabled={documentsBusy}
                  onClick={() => void uploadDocuments()}
                >
                  {documentsBusy ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}
                  Upload selected documents
                </button>
              )}
            </div>
          )}
          {documents.length ? (
            <div className="employee-document-list">
              {documents.map((document) => (
                <article className="employee-document-row" key={document.id}>
                  <FileText size={17} />
                  <div>
                    <strong>{documentTypeLabel(document.documentType)}</strong>
                    <small>
                      {formatFileSize(document.size)} · {new Date(document.uploadedAt).toLocaleDateString()}
                    </small>
                  </div>
                  <a
                    className="button button-secondary button-small"
                    href={document.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ArrowDownToLine size={14} /> Open
                  </a>
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
      {mainAdmin && employee.monthlyBaseSalary !== undefined && (
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
