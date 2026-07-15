import { useMemo, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Download, Upload, FileCheck2, Loader2, CheckCircle2, XCircle, AlertCircle, FileText,
} from "lucide-react";
import { supabase } from "@/integrations/api/client";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  departments: Array<{ id: string; name: string }>;
  units: Array<{ id: string; name: string }>;
  onComplete: () => void;
}

type RowStatus = "ready" | "importing" | "created" | "failed";

interface ParsedRow {
  rowNumber: number;
  name: string;
  email: string;
  username: string;
  password: string;
  employeeId: string;
  contact: string;
  roleLabel: string;
  roleKey: string;
  departmentName: string;
  departmentId: string | null;
  unitName: string;
  unitId: string | null;
  status: RowStatus;
  errorMsg?: string;
}

const ROLE_LABEL_TO_KEY: Record<string, string> = {
  "user": "user",
  "team member": "assigned_person",
  "hod": "hod",
  "admin": "admin",
  "super admin": "super_admin",
  "pc": "pc",
};

const ACCEPTED_UNITS = ["Manesar", "Bilaspur", "Chennai", "Corporate"];

const TEMPLATE_HEADERS = [
  "Full Name", "Email", "Username", "Password", "Employee ID", "Contact", "Role", "Department", "Unit",
];

const TEMPLATE_ROWS = [
  ["John Doe", "john@company.com", "johndoe", "Password@123", "EMP-001", "9876543210", "Team Member", "IT Department", "Manesar"],
  ["Jane Smith", "jane@company.com", "janesmith", "Password@456", "EMP-002", "9876543211", "HOD", "HR Department", "Corporate"],
];

function csvEscape(v: string) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(headers: string[], rows: string[][]) {
  return [headers.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Minimal CSV parser supporting quoted fields and commas inside quotes
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        cur.push(field); field = "";
        if (cur.length > 1 || cur[0] !== "") rows.push(cur);
        cur = [];
      } else field += c;
    }
  }
  if (field !== "" || cur.length > 0) { cur.push(field); rows.push(cur); }
  return rows;
}

export function BulkImportUsersDialog({ open, onOpenChange, departments, units, onComplete }: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const successCount = useMemo(() => rows.filter((r) => r.status === "created").length, [rows]);
  const failCount = useMemo(() => rows.filter((r) => r.status === "failed").length, [rows]);

  const reset = () => {
    setStep(1);
    setFile(null);
    setParsing(false);
    setValidationErrors([]);
    setRows([]);
    setImporting(false);
    setProgress(0);
    setCompleted(false);
  };

  const handleClose = (v: boolean) => {
    if (!v && (importing)) return;
    if (!v) reset();
    onOpenChange(v);
  };

  const handleDownloadTemplate = () => {
    downloadCsv("user_import_template.csv", buildCsv(TEMPLATE_HEADERS, TEMPLATE_ROWS));
  };

  const handleFile = async (f: File) => {
    setFile(f);
    setParsing(true);
    setValidationErrors([]);
    setRows([]);
    try {
      const text = await f.text();
      const matrix = parseCsv(text);
      if (matrix.length < 2) {
        setValidationErrors(["CSV is empty or missing data rows."]);
        setParsing(false);
        return;
      }
      const header = matrix[0].map((h) => h.trim());
      const expected = TEMPLATE_HEADERS;
      const headerOk = expected.every((h, i) => (header[i] || "").toLowerCase() === h.toLowerCase());
      if (!headerOk) {
        setValidationErrors([`CSV headers must be exactly: ${expected.join(", ")}`]);
        setParsing(false);
        return;
      }
      const dataRows = matrix.slice(1).filter((r) => r.some((c) => c && c.trim() !== ""));

      // Pre-fetch existing employee IDs
      const { data: existingProfiles } = await supabase.from("profiles").select("employee_id");
      const existingEmpIds = new Set(
        (existingProfiles || []).map((p: any) => (p.employee_id || "").toString().trim().toLowerCase()).filter(Boolean)
      );

      const errors: string[] = [];
      const seenEmails = new Set<string>();
      const seenEmpIds = new Set<string>();
      const parsed: ParsedRow[] = [];

      dataRows.forEach((r, idx) => {
        const rowNumber = idx + 2; // header is row 1
        const [name, email, username, password, employeeId, contact, roleLabel, departmentName, unitName] = r.map((c) => (c || "").trim());

        const rowErrs: string[] = [];
        if (!name) rowErrs.push("Full Name is empty");
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) rowErrs.push("Invalid email");
        if (!password || password.length < 6) rowErrs.push("Password must be at least 6 characters");
        if (contact && !/^\d{10}$/.test(contact)) rowErrs.push("Contact must be 10 digits numeric");

        const roleKey = ROLE_LABEL_TO_KEY[roleLabel.toLowerCase()];
        if (!roleKey) rowErrs.push(`Invalid role value '${roleLabel}'`);

        let unitId: string | null = null;
        if (!unitName || !ACCEPTED_UNITS.map((u) => u.toLowerCase()).includes(unitName.toLowerCase())) {
          rowErrs.push(`Invalid unit value '${unitName}'`);
        } else {
          const u = units.find((x) => x.name.toLowerCase() === unitName.toLowerCase());
          if (!u) rowErrs.push(`Unit '${unitName}' not configured in system`);
          else unitId = u.id;
        }

        let departmentId: string | null = null;
        if (departmentName) {
          const d = departments.find((x) => x.name.toLowerCase() === departmentName.toLowerCase());
          if (!d) rowErrs.push(`Invalid department '${departmentName}'`);
          else departmentId = d.id;
        }

        const emailKey = email.toLowerCase();
        if (emailKey && seenEmails.has(emailKey)) rowErrs.push("Duplicate email in CSV");
        seenEmails.add(emailKey);

        const empKey = (employeeId || "").toLowerCase();
        if (empKey) {
          if (seenEmpIds.has(empKey)) rowErrs.push("Duplicate Employee ID in CSV");
          if (existingEmpIds.has(empKey)) rowErrs.push("Employee ID already exists");
          seenEmpIds.add(empKey);
        }

        if (rowErrs.length) errors.push(`Row ${rowNumber}: ${rowErrs.join("; ")}`);

        parsed.push({
          rowNumber, name, email, username, password, employeeId, contact,
          roleLabel, roleKey: roleKey || "user",
          departmentName, departmentId,
          unitName, unitId,
          status: "ready",
        });
      });

      if (errors.length) {
        setValidationErrors(errors);
        setRows([]);
      } else {
        setRows(parsed);
        setStep(3);
      }
    } catch (e: any) {
      setValidationErrors([`Failed to parse CSV: ${e?.message || e}`]);
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setProgress(0);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const total = rows.length;
    for (let i = 0; i < total; i++) {
      setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "importing" } : r)));
      const r = rows[i];
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/functions/v1/admin-create-user`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            email: r.email,
            password: r.password,
            name: r.name,
            username: r.username,
            employeeId: r.employeeId,
            contact: r.contact,
            role: r.roleKey,
            departmentId: r.departmentId || "none",
            unitId: r.unitId,
          }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || "Failed to create user");
        setRows((prev) => prev.map((row, idx) => (idx === i ? { ...row, status: "created" } : row)));
      } catch (err: any) {
        setRows((prev) => prev.map((row, idx) => (idx === i ? { ...row, status: "failed", errorMsg: err?.message || "Unknown error" } : row)));
      }
      setProgress(Math.round(((i + 1) / total) * 100));
    }
    setImporting(false);
    setCompleted(true);
    onComplete();
    toast({ title: "Bulk import complete" });
  };

  const handleDownloadErrorReport = () => {
    const failed = rows.filter((r) => r.status === "failed");
    const headers = [...TEMPLATE_HEADERS, "Error"];
    // Security: never include plaintext passwords in the downloadable error report
    const data = failed.map((r) => [
      r.name, r.email, r.username, "[REDACTED]", r.employeeId, r.contact, r.roleLabel, r.departmentName, r.unitName, r.errorMsg || "",
    ]);
    downloadCsv("user_import_errors.csv", buildCsv(headers, data));
  };

  const Stepper = () => {
    const items = [
      { n: 1, label: "Download Template" },
      { n: 2, label: "Upload CSV" },
      { n: 3, label: "Review and Import" },
    ];
    return (
      <div className="flex items-center justify-between mb-6">
        {items.map((it, i) => (
          <div key={it.n} className="flex items-center flex-1">
            <div className={`flex items-center gap-2 ${step >= it.n ? "text-primary" : "text-muted-foreground"}`}>
              <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold border ${step >= it.n ? "bg-primary text-primary-foreground border-primary" : "bg-background border-muted-foreground/30"}`}>
                {it.n}
              </div>
              <span className="text-sm font-medium hidden sm:inline">{it.label}</span>
            </div>
            {i < items.length - 1 && <div className={`flex-1 h-px mx-2 ${step > it.n ? "bg-primary" : "bg-border"}`} />}
          </div>
        ))}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Import Users</DialogTitle>
          <DialogDescription>Import multiple users at once using a CSV file.</DialogDescription>
        </DialogHeader>

        <Stepper />

        {importing && (
          <div className="mb-4 space-y-2">
            <p className="text-sm font-medium">Importing {rows.filter((r) => r.status === "created" || r.status === "failed").length} of {rows.length} users...</p>
            <Progress value={progress} />
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-start gap-3">
                  <FileText className="h-5 w-5 text-primary mt-0.5" />
                  <p className="text-sm text-muted-foreground">
                    Download our CSV template, fill in your user details, then upload it back here.
                  </p>
                </div>
                <Button onClick={handleDownloadTemplate} variant="default">
                  <Download className="h-4 w-4 mr-2" /> Download Template
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6 space-y-3 text-sm">
                <p className="font-semibold">Field Guide — Accepted Values</p>
                <div>
                  <span className="font-medium">Role:</span>{" "}
                  <span className="text-muted-foreground">User, Team Member, HOD, Admin, Super Admin, PC</span>
                </div>
                <div>
                  <span className="font-medium">Department:</span>{" "}
                  <span className="text-muted-foreground">
                    {departments.length ? departments.map((d) => d.name).join(", ") : "No departments configured yet"}
                  </span>
                </div>
                <div>
                  <span className="font-medium">Unit:</span>{" "}
                  <span className="text-muted-foreground">{ACCEPTED_UNITS.join(", ")}</span>
                </div>
              </CardContent>
            </Card>

            <DialogFooter>
              <Button onClick={() => setStep(2)}>Next</Button>
            </DialogFooter>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handleFile(f);
              }}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/30"}`}
            >
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">Drag and drop your CSV file here</p>
              <p className="text-xs text-muted-foreground mt-1">
                or{" "}
                <button
                  type="button"
                  className="text-primary underline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  click to browse
                </button>
                {" "}— only .csv files accepted
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
            </div>

            {file && (
              <div className="flex items-center gap-2 text-sm">
                <FileCheck2 className="h-4 w-4 text-green-600" />
                <span className="font-medium">{file.name}</span>
                <span className="text-muted-foreground">({(file.size / 1024).toFixed(1)} KB)</span>
              </div>
            )}

            {parsing && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Parsing and validating...
              </div>
            )}

            {validationErrors.length > 0 && (
              <Card className="border-destructive/30 bg-destructive/5">
                <CardContent className="pt-4 space-y-2">
                  <div className="flex items-center gap-2 text-destructive font-semibold text-sm">
                    <AlertCircle className="h-4 w-4" /> Validation errors — please fix and re-upload
                  </div>
                  <ul className="text-xs space-y-1 max-h-48 overflow-y-auto">
                    {validationErrors.map((e, i) => (
                      <li key={i} className="text-destructive">{e}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
            </DialogFooter>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            {!completed ? (
              <Card className="border-green-500/30 bg-green-500/5">
                <CardContent className="pt-4 text-sm">
                  <div className="flex items-center gap-2 font-medium text-green-700">
                    <CheckCircle2 className="h-4 w-4" />
                    {rows.length} users ready to import. No errors found.
                  </div>
                  <p className="text-muted-foreground mt-1">
                    You are about to import {rows.length} users. This action will create their accounts and send them login credentials.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="pt-4 text-sm font-medium">
                  Import complete — {successCount} users created successfully, {failCount} failed.
                </CardContent>
              </Card>
            )}

            <div className="border rounded-md overflow-x-auto max-h-[40vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Full Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Employee ID</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.rowNumber}>
                      <TableCell className="text-sm">{r.name}</TableCell>
                      <TableCell className="text-sm">{r.email}</TableCell>
                      <TableCell className="text-sm">{r.employeeId || "—"}</TableCell>
                      <TableCell className="text-sm">{r.roleLabel}</TableCell>
                      <TableCell className="text-sm">{r.departmentName || "—"}</TableCell>
                      <TableCell className="text-sm">{r.unitName}</TableCell>
                      <TableCell className="text-sm">
                        {r.status === "ready" && <span className="text-green-600 font-medium">Ready</span>}
                        {r.status === "importing" && (
                          <span className="text-amber-600 font-medium inline-flex items-center gap-1">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Importing...
                          </span>
                        )}
                        {r.status === "created" && (
                          <span className="text-green-600 font-medium inline-flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Created
                          </span>
                        )}
                        {r.status === "failed" && (
                          <span className="text-destructive font-medium inline-flex items-center gap-1">
                            <XCircle className="h-3.5 w-3.5" /> {r.errorMsg}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <DialogFooter className="gap-2">
              {!completed && !importing && (
                <>
                  <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
                  <Button onClick={handleImport}>Import All Users</Button>
                </>
              )}
              {completed && (
                <>
                  {failCount > 0 && (
                    <Button variant="outline" onClick={handleDownloadErrorReport}>
                      <Download className="h-4 w-4 mr-2" /> Download Error Report
                    </Button>
                  )}
                  <Button onClick={() => handleClose(false)}>Done</Button>
                </>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
