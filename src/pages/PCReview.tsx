import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TicketIdLink } from "@/components/TicketIdLink";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/api/client";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format } from "date-fns";
import { formatDate, getAppTodayStr, getAppDateStrDaysAgo, zonedDayRangeUtc } from "@/utils/dateFormat";
import {
  Search, CalendarIcon, AlertTriangle, CheckCircle2, X, Send, UserX, Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SignedImage, SignedLink } from "@/components/SignedMedia";
import { usePagination } from "@/hooks/usePagination";
import { buildPageMeta } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";
import { orIlike } from "@/lib/searchFilter";

function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function daysBetween(from: Date, to: Date) {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

const OVERDUE_SELECT =
  "*, issue_dept:departments!tickets_issue_department_id_fkey(id,name), unit:units!tickets_unit_id_fkey(id,name), assignee:profiles!tickets_assigned_to_fkey(name)";
const UNASSIGNED_SELECT =
  "*, issue_dept:departments!tickets_issue_department_id_fkey(id,name), unit:units!tickets_unit_id_fkey(id,name), assignee:profiles!tickets_assigned_to_fkey(name), raiser:profiles!tickets_raised_by_fkey(name)";

export default function PCReview() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { allowedUnitNames } = useAuth();


  const [plant, setPlant] = useState<string>("all");
  const [department, setDepartment] = useState<string>("all");
  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput, 300);
  // Interpret the picked calendar days as Nairobi day boundaries, not the
  // viewer's own browser-local midnight — see zonedDayRangeUtc.
  const fromDateStr = fromDate ? zonedDayRangeUtc(fromDate).start.toISOString() : undefined;
  const toDateStr = toDate ? zonedDayRangeUtc(toDate).end.toISOString() : undefined;

  const [remindedIds, setRemindedIds] = useState<Set<string>>(new Set());
  const [proofPhotos, setProofPhotos] = useState<string[] | null>(null);

  // Reset every tab back to page 1 whenever any filter/search changes.
  const filterKey = JSON.stringify({ plant, department, fromDateStr, toDateStr, search });
  const overduePagination = usePagination({ resetKey: filterKey });
  const pendingPagination = usePagination({ resetKey: filterKey });
  const unassignedPagination = usePagination({ resetKey: filterKey });

  const { data: units } = useQuery({
    queryKey: ["pc-review-units", allowedUnitNames?.join(",") ?? "all"],
    queryFn: async () => {
      let q = supabase.from("units").select("id,name").order("name");
      if (allowedUnitNames) q = q.in("name", allowedUnitNames.length ? allowedUnitNames : ["__none__"]);
      const { data } = await q;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: departments } = useQuery({
    queryKey: ["pc-review-departments"],
    queryFn: async () => {
      const { data } = await supabase.from("departments").select("id,name").eq("is_active", true).order("name");
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  /** Common plant/department/date-range/search filters shared by the overdue and unassigned queries. */
  function applyCommonFilters(q: any, dateField: "target_date" | "created_at") {
    if (plant !== "all") q = q.eq("unit_id", plant);
    if (department !== "all") q = q.eq("issue_department_id", department);
    if (fromDateStr) q = q.gte(dateField, fromDateStr);
    if (toDateStr) q = q.lte(dateField, toDateStr);
    if (search) q = q.or(orIlike([["ticket_number", search], ["title", search], ["description", search]]));
    return q;
  }

  // Overdue tickets: target_date < today AND status not resolved/closed
  // ("today" is the application's Nairobi calendar day, not UTC or the viewer's own).
  const todayStr = getAppTodayStr();
  function buildOverdueBase() {
    const q = supabase.from("tickets").lt("target_date", todayStr).not("status", "in", "(resolved,closed)");
    return applyCommonFilters(q, "target_date");
  }

  const { data: overduePageRows = [], isLoading: overdueLoading, isFetching: overdueFetching } = useQuery({
    queryKey: ["pc-review-overdue", "rows", todayStr, plant, department, fromDateStr, toDateStr, search, overduePagination.page],
    queryFn: async () => {
      const { data } = await buildOverdueBase()
        .select(OVERDUE_SELECT)
        .order("target_date", { ascending: true })
        .range(overduePagination.range.from, overduePagination.range.to);
      return data || [];
    },
  });

  const { data: overdueCount = 0 } = useQuery({
    queryKey: ["pc-review-overdue", "count", todayStr, plant, department, fromDateStr, toDateStr, search],
    queryFn: async () => {
      const { count } = await buildOverdueBase().select("id", { head: true, count: "exact" });
      return count ?? 0;
    },
  });

  // Critical = overdue by 15+ days, scoped by the same active filters.
  const cutoff15Str = useMemo(() => getAppDateStrDaysAgo(15), []);
  const { data: criticalCount = 0 } = useQuery({
    queryKey: ["pc-review-critical", "count", cutoff15Str, plant, department, fromDateStr, toDateStr, search],
    queryFn: async () => {
      const q = applyCommonFilters(
        supabase.from("tickets").lt("target_date", cutoff15Str).not("status", "in", "(resolved,closed)"),
        "target_date",
      );
      const { count } = await q.select("id", { head: true, count: "exact" });
      return count ?? 0;
    },
  });

  // Pending feedback: status resolved/closed AND no rating. Left as a full
  // fetch + client-side anti-join (deliberate exception — see project plan):
  // this set is self-limiting (shrinks as people rate tickets) and won't
  // reach ticket-table scale the way the other lists can.
  const { data: pendingRaw, isLoading: pendingLoading } = useQuery({
    queryKey: ["pc-review-pending"],
    queryFn: async () => {
      const { data: tickets } = await supabase
        .from("tickets")
        .select("*, issue_dept:departments!tickets_issue_department_id_fkey(id,name), unit:units!tickets_unit_id_fkey(id,name), assignee:profiles!tickets_assigned_to_fkey(name), closer:profiles!tickets_closed_by_fkey(name), raiser:profiles!tickets_raised_by_fkey(name)")
        .eq("status", "closed")
        .order("closed_at", { ascending: false });
      if (!tickets) return [];
      const ids = tickets.map((t: any) => t.id);
      if (ids.length === 0) return [];
      const { data: ratings } = await supabase
        .from("ticket_ratings")
        .select("ticket_id")
        .in("ticket_id", ids);
      const rated = new Set((ratings || []).map((r: any) => r.ticket_id));
      return tickets.filter((t: any) => !rated.has(t.id));
    },
  });

  // Unassigned OR No Target Date (excluding resolved/closed)
  function buildUnassignedBase() {
    const q = supabase.from("tickets").not("status", "in", "(resolved,closed)").or("assigned_to.is.null,target_date.is.null");
    return applyCommonFilters(q, "created_at");
  }

  const { data: unassignedPageRows = [], isLoading: unassignedLoading, isFetching: unassignedFetching } = useQuery({
    queryKey: ["pc-review-unassigned", "rows", plant, department, fromDateStr, toDateStr, search, unassignedPagination.page],
    queryFn: async () => {
      const { data } = await buildUnassignedBase()
        .select(UNASSIGNED_SELECT)
        .order("created_at", { ascending: false })
        .range(unassignedPagination.range.from, unassignedPagination.range.to);
      return data || [];
    },
  });

  const { data: unassignedCount = 0 } = useQuery({
    queryKey: ["pc-review-unassigned", "count", plant, department, fromDateStr, toDateStr, search],
    queryFn: async () => {
      const { count } = await buildUnassignedBase().select("id", { head: true, count: "exact" });
      return count ?? 0;
    },
  });

  // Pending feedback stays client-filtered (see note above), so it keeps its
  // own filter functions and is paginated by slicing the filtered array.
  const filterTicket = (t: any) => {
    if (plant !== "all" && t.unit_id !== plant) return false;
    if (department !== "all" && t.issue_department_id !== department) return false;
    if (fromDate) {
      const ref = t.target_date || t.closed_at || t.created_at;
      if (ref && new Date(ref) < zonedDayRangeUtc(fromDate).start) return false;
    }
    if (toDate) {
      const ref = t.target_date || t.closed_at || t.created_at;
      if (ref && new Date(ref) > zonedDayRangeUtc(toDate).end) return false;
    }
    return true;
  };

  const matchSearch = (t: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (t.ticket_number || "").toLowerCase().includes(q) ||
      (t.title || "").toLowerCase().includes(q) ||
      (t.description || "").toLowerCase().includes(q)
    );
  };

  const pendingFiltered = useMemo(
    () => (pendingRaw || []).filter(filterTicket).filter(matchSearch),
    [pendingRaw, plant, department, fromDate, toDate, search]
  );
  const pendingCount = pendingFiltered.length;
  const pendingPageRows = pendingFiltered.slice(
    pendingPagination.range.from,
    pendingPagination.range.to + 1,
  );

  const overdueMeta = buildPageMeta(overduePagination.page, overduePagination.pageSize, overdueCount);
  const pendingMeta = buildPageMeta(pendingPagination.page, pendingPagination.pageSize, pendingCount);
  const unassignedMeta = buildPageMeta(unassignedPagination.page, unassignedPagination.pageSize, unassignedCount);

  const filtersActive =
    plant !== "all" || department !== "all" || !!fromDate || !!toDate || !!search;

  const resetFilters = () => {
    setPlant("all");
    setDepartment("all");
    setFromDate(undefined);
    setToDate(undefined);
    setSearchInput("");
  };

  const handleSendReminder = async (ticket: any) => {
    try {
      await supabase.from("notifications").insert({
        user_id: ticket.raised_by,
        title: t("pcReview.feedbackReminder"),
        message: `Please share feedback for ticket ${ticket.ticket_number}`,
        type: "info",
        ticket_id: ticket.id,
      });
      setRemindedIds(prev => new Set(prev).add(ticket.id));
      toast.success("Reminder sent successfully");
    } catch {
      toast.error("Failed to send reminder");
    }
  };

  return (
    <AppLayout title={t("pcReview.title")}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        {/* Section 1: Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("pcReview.title")}</h1>
          <p className="text-muted-foreground mt-1">
            Monitor overdue and pending feedback tickets across all plants.
          </p>
        </div>

        {/* Section 2: Stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground font-medium">{t("pcReview.totalOverdue")}</CardTitle></CardHeader>
            <CardContent><div className="text-3xl font-bold">{overdueLoading ? <Skeleton className="h-9 w-16" /> : overdueCount}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground font-medium">{t("pcReview.pendingFeedback")}</CardTitle></CardHeader>
            <CardContent><div className="text-3xl font-bold">{pendingLoading ? <Skeleton className="h-9 w-16" /> : pendingCount}</div></CardContent>
          </Card>
          <Card className="border-destructive/60">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground font-medium">{t("pcReview.criticalOverdue")}</CardTitle></CardHeader>
            <CardContent><div className="text-3xl font-bold text-destructive">{overdueLoading ? <Skeleton className="h-9 w-16" /> : criticalCount}</div></CardContent>
          </Card>
        </div>

        {/* Section 3: Sticky filter bar */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border rounded-lg p-3">
          <div className="flex flex-col md:flex-row md:items-center gap-3 flex-wrap">
            <Select value={plant} onValueChange={setPlant}>
              <SelectTrigger className="w-full md:w-[160px]"><SelectValue placeholder={t("common.plant")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common.allPlants")}</SelectItem>
                {(units || []).map((u: any) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger className="w-full md:w-[180px]"><SelectValue placeholder={t("common.department")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common.allDepartments")}</SelectItem>
                {(departments || []).map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("w-full md:w-[160px] justify-start font-normal", !fromDate && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {fromDate ? format(fromDate, "dd-MM-yyyy") : "From"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={fromDate} onSelect={setFromDate} initialFocus className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("w-full md:w-[160px] justify-start font-normal", !toDate && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {toDate ? format(toDate, "dd-MM-yyyy") : "To"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={toDate} onSelect={setToDate} initialFocus className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>

            {filtersActive && (
              <button onClick={resetFilters} className="text-sm text-primary hover:underline inline-flex items-center gap-1">
                <X className="h-3 w-3" /> Reset Filters
              </button>
            )}

            <div className="md:ml-auto relative w-full md:w-[280px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("pcReview.searchByIdOrKeyword")}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
        </div>

        {/* Section 4: Tabs */}
        <Tabs defaultValue="overdue" className="w-full">
          <TabsList>
            <TabsTrigger value="overdue">Overdue Tickets ({overdueCount})</TabsTrigger>
            <TabsTrigger value="pending">Pending Feedback Tickets ({pendingCount})</TabsTrigger>
            <TabsTrigger value="unassigned">Unassigned / No Target Date ({unassignedCount})</TabsTrigger>
          </TabsList>

          {/* TAB 1 - Overdue */}
          <TabsContent value="overdue">
            <Card>
              <CardContent className="p-0">
                {filtersActive && (
                  <div className="px-4 py-2 text-xs text-muted-foreground border-b">
                    <Badge variant="outline" className="mr-2">{t("pcReview.filtered")}</Badge>
                    {overdueCount} matching record{overdueCount === 1 ? "" : "s"}
                  </div>
                )}
                {overdueLoading ? (
                  <div className="p-6 space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : overdueCount === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <CheckCircle2 className="h-12 w-12 text-green-600 mb-3" />
                    <p className="text-base font-medium">{t("pcReview.noOverdue")}</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("ticket.ticketId")}</TableHead>
                          <TableHead>{t("pcReview.issueTitle")}</TableHead>
                          <TableHead>{t("common.department")}</TableHead>
                          <TableHead>{t("pcReview.assignedTechnician")}</TableHead>
                          <TableHead>{t("ticket.targetDate")}</TableHead>
                          <TableHead>{t("pcReview.daysOverdue")}</TableHead>
                          <TableHead>{t("common.status")}</TableHead>
                          <TableHead>{t("common.plant")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {overduePageRows.map((t: any) => {
                          const days = daysBetween(new Date(t.target_date), new Date());
                          const borderClass =
                            days >= 15 ? "border-l-4 border-l-destructive" :
                            days >= 8 ? "border-l-4 border-l-orange-500" :
                            "border-l-4 border-l-amber-400";
                          const rowClass = days >= 15 ? "font-semibold" : "";
                          return (
                            <TableRow
                              key={t.id}
                              className={cn(borderClass, rowClass, "cursor-pointer hover:bg-muted/50")}
                              onClick={() => navigate(`/ticket/${t.id}`)}
                            >
                              <TableCell className="font-mono text-xs">
                                <div className="flex items-center gap-1.5">
                                  {days >= 15 && <AlertTriangle className="h-4 w-4 text-destructive" />}
                                  <TicketIdLink ticketNumber={t.ticket_number} />

                                </div>
                              </TableCell>
                              <TableCell className="max-w-[260px] truncate">{t.title}</TableCell>
                              <TableCell>{t.issue_dept?.name || "—"}</TableCell>
                              <TableCell>{t.assignee?.name || "Unassigned"}</TableCell>
                              <TableCell>{t.target_date ? formatDate(t.target_date) : "—"}</TableCell>
                              <TableCell>{days}</TableCell>
                              <TableCell><Badge variant="outline" className="capitalize">{String(t.status).replace("_", " ")}</Badge></TableCell>
                              <TableCell>{t.unit?.name || "—"}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {overdueCount > 0 && (
                  <div className="p-4 border-t">
                    <PaginationControls
                      meta={overdueMeta}
                      onPageChange={overduePagination.setPage}
                      isLoading={overdueFetching}
                      label="tickets"
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 2 - Pending Feedback */}
          <TabsContent value="pending">
            <Card>
              <CardContent className="p-0">
                {filtersActive && (
                  <div className="px-4 py-2 text-xs text-muted-foreground border-b">
                    <Badge variant="outline" className="mr-2">{t("pcReview.filtered")}</Badge>
                    {pendingCount} matching record{pendingCount === 1 ? "" : "s"}
                  </div>
                )}
                {pendingLoading ? (
                  <div className="p-6 space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : pendingCount === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <CheckCircle2 className="h-12 w-12 text-green-600 mb-3" />
                    <p className="text-base font-medium">All resolved tickets have received feedback. Great job!</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("ticket.ticketId")}</TableHead>
                          <TableHead>{t("pcReview.issueTitle")}</TableHead>
                          <TableHead>Raised By</TableHead>
                          <TableHead>Closed Date</TableHead>
                          <TableHead>{t("pcReview.assignedTechnician")}</TableHead>
                          <TableHead>Resolved By</TableHead>
                          <TableHead>Feedback Status</TableHead>
                          <TableHead>Resolution Proof</TableHead>
                          <TableHead>{t("common.plant")}</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pendingPageRows.map((t: any) => {
                          const sent = remindedIds.has(t.id);
                          return (
                            <TableRow key={t.id} className="hover:bg-muted/50">
                              <TableCell className="font-mono text-xs"><TicketIdLink ticketNumber={t.ticket_number} /></TableCell>
                              <TableCell className="max-w-[260px] truncate">{t.title}</TableCell>
                              <TableCell>{t.raiser?.name || "—"}</TableCell>
                              <TableCell>{t.closed_at ? formatDate(t.closed_at) : "—"}</TableCell>
                              <TableCell>{t.assignee?.name || "—"}</TableCell>
                              <TableCell>{t.closer?.name || t.assignee?.name || "—"}</TableCell>
                              <TableCell>
                                <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-300">Pending</Badge>
                              </TableCell>
                              <TableCell>
                                {Array.isArray(t.resolution_photos) && t.resolution_photos.length > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => setProofPhotos(t.resolution_photos as string[])}
                                    className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                                  >
                                    <Eye className="h-3 w-3" /> ✅ Photos Available
                                  </button>
                                ) : (
                                  <span className="inline-flex items-center rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                                    ❌ No Photos
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>{t.unit?.name || "—"}</TableCell>
                              <TableCell>
                                {sent ? (
                                  <Button size="sm" variant="outline" disabled>Reminder Sent</Button>
                                ) : (
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button size="sm" variant="outline"><Send className="h-3 w-3 mr-1" /> Send Reminder</Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>Send Reminder</AlertDialogTitle>
                                        <AlertDialogDescription>Send a feedback reminder to the ticket creator?</AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => handleSendReminder(t)}>Confirm</AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {pendingCount > 0 && (
                  <div className="p-4 border-t">
                    <PaginationControls
                      meta={pendingMeta}
                      onPageChange={pendingPagination.setPage}
                      label="tickets"
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 3 - Unassigned / No Target Date */}
          <TabsContent value="unassigned">
            <Card>
              <CardContent className="p-0">
                {filtersActive && (
                  <div className="px-4 py-2 text-xs text-muted-foreground border-b">
                    <Badge variant="outline" className="mr-2">{t("pcReview.filtered")}</Badge>
                    {unassignedCount} matching record{unassignedCount === 1 ? "" : "s"}
                  </div>
                )}
                {unassignedLoading ? (
                  <div className="p-6 space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : unassignedCount === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <CheckCircle2 className="h-12 w-12 text-green-600 mb-3" />
                    <p className="text-base font-medium">All tickets are assigned and have target dates set. Great job!</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("ticket.ticketId")}</TableHead>
                          <TableHead>{t("pcReview.issueTitle")}</TableHead>
                          <TableHead>{t("common.department")}</TableHead>
                          <TableHead>{t("common.plant")}</TableHead>
                          <TableHead>Raised By</TableHead>
                          <TableHead>{t("pcReview.assignedTechnician")}</TableHead>
                          <TableHead>{t("ticket.targetDate")}</TableHead>
                          <TableHead>{t("common.status")}</TableHead>
                          <TableHead>Missing Info</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {unassignedPageRows.map((t: any) => {
                          const noAssignee = !t.assigned_to;
                          const noTarget = !t.target_date;
                          return (
                            <TableRow
                              key={t.id}
                              className="cursor-pointer hover:bg-muted/50"
                              onClick={() => navigate(`/ticket/${t.id}`)}
                            >
                              <TableCell className="font-mono text-xs">
                                <div className="flex items-center gap-1.5">
                                  {noAssignee && <UserX className="h-4 w-4 text-destructive" />}
                                  <TicketIdLink ticketNumber={t.ticket_number} />

                                </div>
                              </TableCell>
                              <TableCell className="max-w-[260px] truncate">{t.title}</TableCell>
                              <TableCell>{t.issue_dept?.name || "—"}</TableCell>
                              <TableCell>{t.unit?.name || "—"}</TableCell>
                              <TableCell>{t.raiser?.name || "—"}</TableCell>
                              <TableCell className={noAssignee ? "text-destructive font-medium" : ""}>
                                {noAssignee ? "Not Assigned" : t.assignee?.name}
                              </TableCell>
                              <TableCell className={noTarget ? "text-destructive font-medium" : ""}>
                                {noTarget ? "Not Set" : formatDate(t.target_date)}
                              </TableCell>
                              <TableCell><Badge variant="outline" className="capitalize">{String(t.status).replace("_", " ")}</Badge></TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {noAssignee && (
                                    <Badge className="bg-destructive/15 text-destructive hover:bg-destructive/15 border-destructive/30">No Assignee</Badge>
                                  )}
                                  {noTarget && (
                                    <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-300">No Target Date</Badge>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {unassignedCount > 0 && (
                  <div className="p-4 border-t">
                    <PaginationControls
                      meta={unassignedMeta}
                      onPageChange={unassignedPagination.setPage}
                      isLoading={unassignedFetching}
                      label="tickets"
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!proofPhotos} onOpenChange={(o) => !o && setProofPhotos(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Resolution Proof Photos</DialogTitle>
          </DialogHeader>
          {proofPhotos && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[70vh] overflow-y-auto">
              {proofPhotos.map((url, i) => (
                <SignedLink key={i} href={url} bucket="ticket-resolution-photos" className="block rounded-lg border overflow-hidden">
                  <SignedImage src={url} bucket="ticket-resolution-photos" alt={`Proof ${i + 1}`} className="w-full h-40 object-cover" />
                </SignedLink>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
