import { useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarIcon, ChevronDown, Download, Eye, Search } from "lucide-react";
import { TicketIdLink } from "@/components/TicketIdLink";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/api/client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { format, subDays, differenceInCalendarDays } from "date-fns";
import { formatDate, formatDateShort } from "@/utils/dateFormat";
import { cn } from "@/lib/utils";

function ViewEyeButton({ ticketNumber }: { ticketNumber: string }) {
  const [params, setParams] = useSearchParams();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        const next = new URLSearchParams(params);
        next.set("ticket", ticketNumber);
        setParams(next, { replace: false });
      }}
      className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700 transition-colors"
      title={`View ${ticketNumber}`}
      aria-label={`View ticket ${ticketNumber}`}
    >
      <Eye className="h-3.5 w-3.5" />
    </button>
  );
}

type StatusKey = "Pending" | "In Progress" | "Resolved";

const PENDING_STATUSES = ["open", "reopened"];
const IN_PROGRESS_STATUSES = ["in_progress"];
const RESOLVED_STATUSES = ["resolved", "closed"];

function displayStatus(s: string): StatusKey {
  if (RESOLVED_STATUSES.includes(s)) return "Resolved";
  if (IN_PROGRESS_STATUSES.includes(s)) return "In Progress";
  return "Pending";
}

const StatusBadge = ({ status }: { status: StatusKey }) => {
  const map: Record<StatusKey, string> = {
    Pending: "bg-[#FEE2E2] text-[#DC2626]",
    "In Progress": "bg-[#DBEAFE] text-[#2563EB]",
    Resolved: "bg-[#DCFCE7] text-[#16A34A]",
  };
  return (
    <span className={cn("inline-block px-2 py-0.5 rounded text-[11px] font-medium", map[status])}>
      {status}
    </span>
  );
};

const Stars = ({ rating }: { rating: number | null }) => {
  if (!rating) return <span className="text-muted-foreground">—</span>;
  const r = Math.round(rating);
  return (
    <span className="text-yellow-500 text-[13px]">
      {"★".repeat(r)}
      <span className="text-gray-300">{"☆".repeat(5 - r)}</span>
    </span>
  );
};

type SortDir = "asc" | "desc";

function useSort<T>(rows: T[], initialKey: keyof T | null = null) {
  const [sortKey, setSortKey] = useState<keyof T | null>(initialKey);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const arr = [...rows];
    arr.sort((a: any, b: any) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return arr;
  }, [rows, sortKey, sortDir]);
  const toggle = (k: keyof T) => {
    if (sortKey === k) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };
  return { sorted, sortKey, sortDir, toggle };
}

const SortHeader = ({ label, active, dir, onClick, className }: { label: string; active: boolean; dir: SortDir; onClick: () => void; className?: string }) => (
  <th
    onClick={onClick}
    className={cn("px-2.5 py-2 text-left text-white font-semibold text-[12px] cursor-pointer select-none whitespace-nowrap", className)}
  >
    <span className="inline-flex items-center gap-1">
      {label}
      {active ? (dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-50" />}
    </span>
  </th>
);

interface PendingRow {
  id: string;
  ticket_number: string;
  unit: string;
  department: string;
  issue_date: string; // ISO
  issue_date_label: string;
  issues: string;
  raised_by: string;
  status: StatusKey;
  aging: number;
}

interface ResolvedRow {
  id: string;
  ticket_number: string;
  unit: string;
  department: string;
  resolved_date: string;
  resolved_date_label: string;
  aging: number;
  technician: string;
  resolved_by: string;
  raised_by: string;
  rating: number | null;
  rating_remarks: string;
}

export default function Reports() {
  const { user, allowedUnitNames } = useAuth();

  // ---- Filters ----
  const [unitFilter, setUnitFilter] = useState<string[] | null>(null); // null = all
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });

  const { data: units = [] } = useQuery({
    queryKey: ["summary-units", allowedUnitNames?.join(",") ?? "all"],
    queryFn: async () => {
      let q = supabase.from("units").select("id, name").order("name");
      if (allowedUnitNames) q = q.in("name", allowedUnitNames.length ? allowedUnitNames : ["__none__"]);
      const { data } = await q;
      return data || [];
    },
    enabled: !!user,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["summary-departments"],
    queryFn: async () => {
      const { data } = await supabase.from("departments").select("id, name").eq("is_active", true).order("name");
      return data || [];
    },
    enabled: !!user,
  });

  const selectedUnitNames = unitFilter ?? units.map(u => u.name);

  const { data: tickets, isLoading, error, refetch } = useQuery({
    queryKey: ["summary-tickets", selectedUnitNames.join(","), deptFilter, dateRange.from?.toISOString(), dateRange.to?.toISOString()],
    queryFn: async () => {
      const fromISO = dateRange.from.toISOString();
      const toISO = new Date(dateRange.to.getTime() + 24 * 60 * 60 * 1000 - 1).toISOString();
      let q = supabase
        .from("tickets")
        .select(`
          id, ticket_number, title, status, created_at, closed_at, raised_by, assigned_to,
          unit:units!tickets_unit_id_fkey(name),
          dept:departments!tickets_issue_department_id_fkey(name),
          raiser:profiles!tickets_raised_by_fkey(name),
          assignee:profiles!tickets_assigned_to_fkey(name),
          closer:profiles!tickets_closed_by_fkey(name),
          rating:ticket_ratings(rating, feedback)
        `)
        .gte("created_at", fromISO)
        .lte("created_at", toISO)
        .order("created_at", { ascending: false });

      if (selectedUnitNames.length > 0 && selectedUnitNames.length < units.length) {
        const unitIds = units.filter(u => selectedUnitNames.includes(u.name)).map(u => u.id);
        if (unitIds.length) q = q.in("unit_id", unitIds);
      }
      if (deptFilter !== "all") {
        const dept = departments.find(d => d.name === deptFilter);
        if (dept) q = q.eq("issue_department_id", dept.id);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && units.length > 0,
  });

  // ---- Split + map ----
  const today = new Date();
  const pendingRows: PendingRow[] = useMemo(() => {
    return (tickets || [])
      .filter((t: any) => !RESOLVED_STATUSES.includes(t.status))
      .map((t: any) => ({
        id: t.id,
        ticket_number: t.ticket_number,
        unit: t.unit?.name || "—",
        department: t.dept?.name || "—",
        issue_date: t.created_at,
        issue_date_label: formatDateShort(t.created_at),
        issues: t.title || "",
        raised_by: t.raiser?.name || "—",
        status: displayStatus(t.status),
        aging: differenceInCalendarDays(today, new Date(t.created_at)),
      }));
  }, [tickets]);

  const resolvedRows: ResolvedRow[] = useMemo(() => {
    return (tickets || [])
      .filter((t: any) => RESOLVED_STATUSES.includes(t.status))
      .map((t: any) => {
        const resolvedAt = t.closed_at || t.created_at;
        const ratingRow = Array.isArray(t.rating) ? t.rating[0] : t.rating;
        return {
          id: t.id,
          ticket_number: t.ticket_number,
          unit: t.unit?.name || "—",
          department: t.dept?.name || "—",
          resolved_date: resolvedAt,
          resolved_date_label: formatDate(resolvedAt),
          aging: differenceInCalendarDays(new Date(resolvedAt), new Date(t.created_at)),
          technician: t.assignee?.name || "—",
          resolved_by: t.closer?.name || t.assignee?.name || "—",
          raised_by: t.raiser?.name || "—",
          rating: ratingRow?.rating ?? null,
          rating_remarks: ratingRow?.feedback || "",
        };
      });
  }, [tickets]);

  // ---- Search ----
  const [pendingSearch, setPendingSearch] = useState("");
  const [resolvedSearch, setResolvedSearch] = useState("");
  const pendingFiltered = useMemo(() => {
    const q = pendingSearch.toLowerCase().trim();
    if (!q) return pendingRows;
    return pendingRows.filter(r =>
      r.ticket_number.toLowerCase().includes(q) ||
      r.unit.toLowerCase().includes(q) ||
      r.department.toLowerCase().includes(q) ||
      r.raised_by.toLowerCase().includes(q),
    );
  }, [pendingRows, pendingSearch]);
  const resolvedFiltered = useMemo(() => {
    const q = resolvedSearch.toLowerCase().trim();
    if (!q) return resolvedRows;
    return resolvedRows.filter(r =>
      r.ticket_number.toLowerCase().includes(q) ||
      r.unit.toLowerCase().includes(q) ||
      r.department.toLowerCase().includes(q) ||
      r.raised_by.toLowerCase().includes(q),
    );
  }, [resolvedRows, resolvedSearch]);

  // ---- Sort ----
  const pSort = useSort<PendingRow>(pendingFiltered);
  const rSort = useSort<ResolvedRow>(resolvedFiltered);

  // ---- Pagination ----
  const [pPage, setPPage] = useState(1);
  const [pSize, setPSize] = useState(25);
  const [rPage, setRPage] = useState(1);
  const [rSize, setRSize] = useState(25);

  const pTotal = pSort.sorted.length;
  const rTotal = rSort.sorted.length;
  const pStart = (pPage - 1) * pSize;
  const rStart = (rPage - 1) * rSize;
  const pPageRows = pSort.sorted.slice(pStart, pStart + pSize);
  const rPageRows = rSort.sorted.slice(rStart, rStart + rSize);

  // Reset page when filters change
  useMemo(() => { setPPage(1); setRPage(1); }, [pendingSearch, resolvedSearch, unitFilter, deptFilter, dateRange]);

  // ---- Export CSV ----
  const exportCSV = () => {
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines: string[] = [];
    lines.push("PENDING / IN-PROGRESS TICKETS");
    lines.push(["#", "Issue ID", "Unit", "Department", "Issue Date", "Issues", "Raised By", "Status", "Aging (Days)"].map(esc).join(","));
    pSort.sorted.forEach((r, i) => {
      lines.push([i + 1, r.ticket_number, r.unit, r.department, r.issue_date_label, r.issues, r.raised_by, r.status, r.aging].map(esc).join(","));
    });
    lines.push("");
    lines.push("RESOLVED TICKETS");
    lines.push(["#", "Issue ID", "Unit", "Department", "Resolved Date", "Aging (Days)", "Technician", "Resolved By", "Raised By", "Rating", "Rating Remarks"].map(esc).join(","));
    rSort.sorted.forEach((r, i) => {
      lines.push([i + 1, r.ticket_number, r.unit, r.department, r.resolved_date_label, r.aging, r.technician, r.resolved_by, r.raised_by, r.rating ?? "", r.rating_remarks].map(esc).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `summary-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const allUnitsSelected = unitFilter === null || unitFilter.length === units.length;
  const unitLabel = allUnitsSelected
    ? `Unit: All (${units.length})`
    : `Unit: ${unitFilter!.length} selected`;

  return (
    <AppLayout title="Summary Dashboard">
      <div className="space-y-4">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3 p-3 bg-card border rounded-lg shadow-sm">
          {/* Unit multi-select */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="min-w-[200px] justify-between">
                <span className="truncate">{unitLabel}</span>
                <ChevronDown className="h-4 w-4 ml-2 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56 bg-popover">
              <DropdownMenuLabel>Units</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={allUnitsSelected}
                onCheckedChange={(c) => setUnitFilter(c ? null : [])}
              >
                All Units
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              {units.map(u => {
                const checked = allUnitsSelected || unitFilter!.includes(u.name);
                return (
                  <DropdownMenuCheckboxItem
                    key={u.id}
                    checked={checked}
                    onCheckedChange={(c) => {
                      const base = allUnitsSelected ? units.map(x => x.name) : [...unitFilter!];
                      const next = c ? Array.from(new Set([...base, u.name])) : base.filter(n => n !== u.name);
                      setUnitFilter(next.length === units.length ? null : next);
                    }}
                  >
                    {u.name}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Department */}
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="w-[200px] h-9">
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map(d => (
                <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Date range */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <CalendarIcon className="h-4 w-4 mr-2" />
                {format(dateRange.from, "dd-MM-yyyy")} – {format(dateRange.to, "dd-MM-yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 bg-popover" align="start">
              <Calendar
                mode="range"
                selected={{ from: dateRange.from, to: dateRange.to }}
                onSelect={(r: any) => {
                  if (r?.from && r?.to) setDateRange({ from: r.from, to: r.to });
                }}
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>

          <div className="ml-auto">
            <Button size="sm" onClick={exportCSV} className="bg-primary">
              <Download className="h-4 w-4 mr-2" /> Export CSV
            </Button>
          </div>
        </div>

        {/* Tables */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* LEFT: Pending / In-Progress */}
          <TableCard
            title="Total Tickets Pending / In-Progress"
            search={pendingSearch}
            onSearch={setPendingSearch}
            isLoading={isLoading}
            error={!!error}
            onRetry={() => refetch()}
            empty={pPageRows.length === 0}
            total={pTotal}
            page={pPage}
            size={pSize}
            onPage={setPPage}
            onSize={setPSize}
            colCount={10}
          >
            <thead className="sticky top-0 z-10 bg-[#1a2744]">
              <tr>
                <th className="px-2.5 py-2 text-left text-white font-semibold text-[12px] w-10">#</th>
                <SortHeader label="Issue ID" active={pSort.sortKey === "ticket_number"} dir={pSort.sortDir} onClick={() => pSort.toggle("ticket_number")} />
                <SortHeader label="Unit" active={pSort.sortKey === "unit"} dir={pSort.sortDir} onClick={() => pSort.toggle("unit")} />
                <SortHeader label="Department" active={pSort.sortKey === "department"} dir={pSort.sortDir} onClick={() => pSort.toggle("department")} />
                <SortHeader label="Issue Date" active={pSort.sortKey === "issue_date"} dir={pSort.sortDir} onClick={() => pSort.toggle("issue_date")} />
                <SortHeader label="Issues" active={pSort.sortKey === "issues"} dir={pSort.sortDir} onClick={() => pSort.toggle("issues")} />
                <SortHeader label="Raised By" active={pSort.sortKey === "raised_by"} dir={pSort.sortDir} onClick={() => pSort.toggle("raised_by")} />
                <SortHeader label="Status" active={pSort.sortKey === "status"} dir={pSort.sortDir} onClick={() => pSort.toggle("status")} />
                <SortHeader label="Aging" active={pSort.sortKey === "aging"} dir={pSort.sortDir} onClick={() => pSort.toggle("aging")} />
                <th className="px-2.5 py-2 text-center text-white font-semibold text-[12px] w-14">View</th>
              </tr>
            </thead>
            <tbody>
              {pPageRows.map((r, i) => (
                <tr
                  key={r.id}
                  style={{ background: r.status === "Pending" ? "#FFF0F0" : "#EFF6FF" }}
                  className="border-b border-[#e2e8f0] text-[12px]"
                >
                  <td className="px-2.5 py-1.5 text-muted-foreground">{pStart + i + 1}.</td>
                  <td className="px-2.5 py-1.5 font-medium whitespace-nowrap"><TicketIdLink ticketNumber={r.ticket_number} /></td>
                  <td className="px-2.5 py-1.5">{r.unit}</td>
                  <td className="px-2.5 py-1.5">{r.department}</td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">{r.issue_date_label}</td>
                  <td className="px-2.5 py-1.5 max-w-[180px] truncate" title={r.issues}>{r.issues}</td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">{r.raised_by}</td>
                  <td className="px-2.5 py-1.5"><StatusBadge status={r.status} /></td>
                  <td className="px-2.5 py-1.5 font-medium">{r.aging}D</td>
                  <td className="px-2.5 py-1.5 text-center"><ViewEyeButton ticketNumber={r.ticket_number} /></td>
                </tr>
              ))}
            </tbody>
          </TableCard>


          {/* RIGHT: Resolved */}
          <TableCard
            title="Total Tickets Resolved"
            search={resolvedSearch}
            onSearch={setResolvedSearch}
            isLoading={isLoading}
            error={!!error}
            onRetry={() => refetch()}
            empty={rPageRows.length === 0}
            total={rTotal}
            page={rPage}
            size={rSize}
            onPage={setRPage}
            onSize={setRSize}
            colCount={12}
          >
            <thead className="sticky top-0 z-10 bg-[#1a2744]">
              <tr>
                <th className="px-2.5 py-2 text-left text-white font-semibold text-[12px] w-10">#</th>
                <SortHeader label="Issue ID" active={rSort.sortKey === "ticket_number"} dir={rSort.sortDir} onClick={() => rSort.toggle("ticket_number")} />
                <SortHeader label="Unit" active={rSort.sortKey === "unit"} dir={rSort.sortDir} onClick={() => rSort.toggle("unit")} />
                <SortHeader label="Department" active={rSort.sortKey === "department"} dir={rSort.sortDir} onClick={() => rSort.toggle("department")} />
                <SortHeader label="Resolved Date" active={rSort.sortKey === "resolved_date"} dir={rSort.sortDir} onClick={() => rSort.toggle("resolved_date")} />
                <SortHeader label="Aging" active={rSort.sortKey === "aging"} dir={rSort.sortDir} onClick={() => rSort.toggle("aging")} />
                <SortHeader label="Technician" active={rSort.sortKey === "technician"} dir={rSort.sortDir} onClick={() => rSort.toggle("technician")} />
                <SortHeader label="Resolved By" active={rSort.sortKey === "resolved_by"} dir={rSort.sortDir} onClick={() => rSort.toggle("resolved_by")} />
                <SortHeader label="Raised By" active={rSort.sortKey === "raised_by"} dir={rSort.sortDir} onClick={() => rSort.toggle("raised_by")} />
                <SortHeader label="Rating" active={rSort.sortKey === "rating"} dir={rSort.sortDir} onClick={() => rSort.toggle("rating")} />
                <SortHeader label="Remarks" active={rSort.sortKey === "rating_remarks"} dir={rSort.sortDir} onClick={() => rSort.toggle("rating_remarks")} />
                <th className="px-2.5 py-2 text-center text-white font-semibold text-[12px] w-14">View</th>
              </tr>
            </thead>
            <tbody>
              {rPageRows.map((r, i) => (
                <tr key={r.id} style={{ background: "#F0FFF4" }} className="border-b border-[#e2e8f0] text-[12px]">
                  <td className="px-2.5 py-1.5 text-muted-foreground">{rStart + i + 1}.</td>
                  <td className="px-2.5 py-1.5 font-medium whitespace-nowrap"><TicketIdLink ticketNumber={r.ticket_number} /></td>
                  <td className="px-2.5 py-1.5">{r.unit}</td>
                  <td className="px-2.5 py-1.5">{r.department}</td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">{r.resolved_date_label}</td>
                  <td className="px-2.5 py-1.5 font-medium">{r.aging}D</td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">{r.technician}</td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">{r.resolved_by}</td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">{r.raised_by}</td>
                  <td className="px-2.5 py-1.5"><Stars rating={r.rating} /></td>
                  <td className="px-2.5 py-1.5 max-w-[160px] truncate" title={r.rating_remarks}>{r.rating_remarks || "—"}</td>
                  <td className="px-2.5 py-1.5 text-center"><ViewEyeButton ticketNumber={r.ticket_number} /></td>
                </tr>
              ))}
            </tbody>
          </TableCard>

        </div>
      </div>
    </AppLayout>
  );
}

interface TableCardProps {
  title: string;
  search: string;
  onSearch: (v: string) => void;
  isLoading: boolean;
  error: boolean;
  onRetry: () => void;
  empty: boolean;
  total: number;
  page: number;
  size: number;
  onPage: (p: number) => void;
  onSize: (s: number) => void;
  colCount: number;
  children: React.ReactNode;
}

function TableCard({
  title, search, onSearch, isLoading, error, onRetry, empty,
  total, page, size, onPage, onSize, colCount, children,
}: TableCardProps) {
  const totalPages = Math.max(1, Math.ceil(total / size));
  const start = total === 0 ? 0 : (page - 1) * size + 1;
  const end = Math.min(page * size, total);

  return (
    <div className="bg-card border rounded-lg shadow-sm overflow-hidden flex flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="relative w-56">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search…"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <div className="overflow-auto" style={{ maxHeight: "70vh" }}>
        <table className="w-full border-collapse">
          {children}
          {(isLoading || error || empty) && (
            <tbody>
              {isLoading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}><td colSpan={colCount} className="p-2"><Skeleton className="h-5 w-full" /></td></tr>
              ))}
              {!isLoading && error && (
                <tr><td colSpan={colCount} className="text-center py-10">
                  <p className="text-sm text-muted-foreground mb-2">Failed to load data. Please refresh.</p>
                  <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
                </td></tr>
              )}
              {!isLoading && !error && empty && (
                <tr><td colSpan={colCount} className="text-center py-10 text-sm text-muted-foreground">
                  No tickets found for selected filters
                </td></tr>
              )}
            </tbody>
          )}
        </table>
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t text-xs text-muted-foreground">
        <span>Showing {start}–{end} of {total} tickets</span>
        <div className="flex items-center gap-2">
          <Select value={String(size)} onValueChange={(v) => { onSize(Number(v)); onPage(1); }}>
            <SelectTrigger className="h-7 w-[80px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-7 px-2" disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</Button>
          <span>{page} / {totalPages}</span>
          <Button variant="outline" size="sm" className="h-7 px-2" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}

