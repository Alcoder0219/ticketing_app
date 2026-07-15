import { useState, useMemo, useEffect } from "react";
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
import { formatDate } from "@/utils/dateFormat";
import {
  Search, CalendarIcon, AlertTriangle, CheckCircle2, X, Send, UserX, Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SignedImage, SignedLink } from "@/components/SignedMedia";

const PAGE_SIZE = 20;

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

export default function PCReview() {
  const navigate = useNavigate();
  const { allowedUnitNames } = useAuth();


  const [plant, setPlant] = useState<string>("all");
  const [department, setDepartment] = useState<string>("all");
  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput, 300);

  const [overduePage, setOverduePage] = useState(1);
  const [pendingPage, setPendingPage] = useState(1);
  const [unassignedPage, setUnassignedPage] = useState(1);
  const [remindedIds, setRemindedIds] = useState<Set<string>>(new Set());
  const [proofPhotos, setProofPhotos] = useState<string[] | null>(null);

  const { data: units } = useQuery({
    queryKey: ["pc-review-units", allowedUnitNames?.join(",") ?? "all"],
    queryFn: async () => {
      let q = supabase.from("units").select("id,name").order("name");
      if (allowedUnitNames) q = q.in("name", allowedUnitNames.length ? allowedUnitNames : ["__none__"]);
      const { data } = await q;
      return data || [];
    },
  });

  const { data: departments } = useQuery({
    queryKey: ["pc-review-departments"],
    queryFn: async () => {
      const { data } = await supabase.from("departments").select("id,name").eq("is_active", true).order("name");
      return data || [];
    },
  });

  // Overdue tickets: target_date < today AND status not resolved/closed
  const todayStr = new Date().toISOString().slice(0, 10);
  const { data: overdueRaw, isLoading: overdueLoading } = useQuery({
    queryKey: ["pc-review-overdue", todayStr],
    queryFn: async () => {
      const { data } = await supabase
        .from("tickets")
        .select("*, issue_dept:departments!tickets_issue_department_id_fkey(id,name), unit:units!tickets_unit_id_fkey(id,name), assignee:profiles!tickets_assigned_to_fkey(name)")
        .lt("target_date", todayStr)
        .not("status", "in", "(resolved,closed)")
        .order("target_date", { ascending: true });
      return data || [];
    },
  });

  // Pending feedback: status resolved/closed AND no rating
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
  const { data: unassignedRaw, isLoading: unassignedLoading } = useQuery({
    queryKey: ["pc-review-unassigned"],
    queryFn: async () => {
      const { data } = await supabase
        .from("tickets")
        .select("*, issue_dept:departments!tickets_issue_department_id_fkey(id,name), unit:units!tickets_unit_id_fkey(id,name), assignee:profiles!tickets_assigned_to_fkey(name), raiser:profiles!tickets_raised_by_fkey(name)")
        .not("status", "in", "(resolved,closed)")
        .or("assigned_to.is.null,target_date.is.null")
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  const filterTicket = (t: any) => {
    if (plant !== "all" && t.unit_id !== plant) return false;
    if (department !== "all" && t.issue_department_id !== department) return false;
    if (fromDate) {
      const ref = t.target_date || t.closed_at || t.created_at;
      if (ref && new Date(ref) < fromDate) return false;
    }
    if (toDate) {
      const ref = t.target_date || t.closed_at || t.created_at;
      if (ref && new Date(ref) > toDate) return false;
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

  const overdueFiltered = useMemo(
    () => (overdueRaw || []).filter(filterTicket).filter(matchSearch),
    [overdueRaw, plant, department, fromDate, toDate, search]
  );
  const pendingFiltered = useMemo(
    () => (pendingRaw || []).filter(filterTicket).filter(matchSearch),
    [pendingRaw, plant, department, fromDate, toDate, search]
  );
  const unassignedFiltered = useMemo(
    () => (unassignedRaw || []).filter(filterTicket).filter(matchSearch),
    [unassignedRaw, plant, department, fromDate, toDate, search]
  );

  const overdueCount = overdueFiltered.length;
  const pendingCount = pendingFiltered.length;
  const unassignedCount = unassignedFiltered.length;
  const criticalCount = useMemo(
    () => overdueFiltered.filter((t: any) => {
      const days = daysBetween(new Date(t.target_date), new Date());
      return days >= 15;
    }).length,
    [overdueFiltered]
  );

  const filtersActive =
    plant !== "all" || department !== "all" || !!fromDate || !!toDate || !!search;

  const resetFilters = () => {
    setPlant("all");
    setDepartment("all");
    setFromDate(undefined);
    setToDate(undefined);
    setSearchInput("");
  };

  // Pagination slices
  const overduePageRows = overdueFiltered.slice((overduePage - 1) * PAGE_SIZE, overduePage * PAGE_SIZE);
  const pendingPageRows = pendingFiltered.slice((pendingPage - 1) * PAGE_SIZE, pendingPage * PAGE_SIZE);
  const unassignedPageRows = unassignedFiltered.slice((unassignedPage - 1) * PAGE_SIZE, unassignedPage * PAGE_SIZE);
  const overduePages = Math.max(1, Math.ceil(overdueCount / PAGE_SIZE));
  const pendingPages = Math.max(1, Math.ceil(pendingCount / PAGE_SIZE));
  const unassignedPages = Math.max(1, Math.ceil(unassignedCount / PAGE_SIZE));

  useEffect(() => { setOverduePage(1); setPendingPage(1); setUnassignedPage(1); }, [plant, department, fromDate, toDate, search]);

  const handleSendReminder = async (ticket: any) => {
    try {
      await supabase.from("notifications").insert({
        user_id: ticket.raised_by,
        title: "Feedback Reminder",
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
    <AppLayout title="PC Review">
      <div className="space-y-6 max-w-[1600px] mx-auto">
        {/* Section 1: Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">PC Review</h1>
          <p className="text-muted-foreground mt-1">
            Monitor overdue and pending feedback tickets across all plants.
          </p>
        </div>

        {/* Section 2: Stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground font-medium">Total Overdue</CardTitle></CardHeader>
            <CardContent><div className="text-3xl font-bold">{overdueLoading ? <Skeleton className="h-9 w-16" /> : overdueCount}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground font-medium">Pending Feedback</CardTitle></CardHeader>
            <CardContent><div className="text-3xl font-bold">{pendingLoading ? <Skeleton className="h-9 w-16" /> : pendingCount}</div></CardContent>
          </Card>
          <Card className="border-destructive/60">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground font-medium">Critical Overdue</CardTitle></CardHeader>
            <CardContent><div className="text-3xl font-bold text-destructive">{overdueLoading ? <Skeleton className="h-9 w-16" /> : criticalCount}</div></CardContent>
          </Card>
        </div>

        {/* Section 3: Sticky filter bar */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border rounded-lg p-3">
          <div className="flex flex-col md:flex-row md:items-center gap-3 flex-wrap">
            <Select value={plant} onValueChange={setPlant}>
              <SelectTrigger className="w-full md:w-[160px]"><SelectValue placeholder="Plant" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Plants</SelectItem>
                {(units || []).map((u: any) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger className="w-full md:w-[180px]"><SelectValue placeholder="Department" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
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
                placeholder="Search by Ticket ID or keyword..."
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
                    <Badge variant="outline" className="mr-2">Filtered</Badge>
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
                    <p className="text-base font-medium">No overdue tickets. Everything is on track!</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Ticket ID</TableHead>
                          <TableHead>Issue / Title</TableHead>
                          <TableHead>Department</TableHead>
                          <TableHead>Assigned Technician</TableHead>
                          <TableHead>Target Date</TableHead>
                          <TableHead>Days Overdue</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Plant</TableHead>
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
                  <div className="flex items-center justify-between p-4 border-t">
                    <div className="text-xs text-muted-foreground">
                      Showing {(overduePage - 1) * PAGE_SIZE + 1}–{Math.min(overduePage * PAGE_SIZE, overdueCount)} of {overdueCount} tickets
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={overduePage === 1} onClick={() => setOverduePage(p => p - 1)}>Previous</Button>
                      <Button variant="outline" size="sm" disabled={overduePage >= overduePages} onClick={() => setOverduePage(p => p + 1)}>Next</Button>
                    </div>
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
                    <Badge variant="outline" className="mr-2">Filtered</Badge>
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
                          <TableHead>Ticket ID</TableHead>
                          <TableHead>Issue / Title</TableHead>
                          <TableHead>Raised By</TableHead>
                          <TableHead>Closed Date</TableHead>
                          <TableHead>Assigned Technician</TableHead>
                          <TableHead>Resolved By</TableHead>
                          <TableHead>Feedback Status</TableHead>
                          <TableHead>Resolution Proof</TableHead>
                          <TableHead>Plant</TableHead>
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
                  <div className="flex items-center justify-between p-4 border-t">
                    <div className="text-xs text-muted-foreground">
                      Showing {(pendingPage - 1) * PAGE_SIZE + 1}–{Math.min(pendingPage * PAGE_SIZE, pendingCount)} of {pendingCount} tickets
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={pendingPage === 1} onClick={() => setPendingPage(p => p - 1)}>Previous</Button>
                      <Button variant="outline" size="sm" disabled={pendingPage >= pendingPages} onClick={() => setPendingPage(p => p + 1)}>Next</Button>
                    </div>
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
                    <Badge variant="outline" className="mr-2">Filtered</Badge>
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
                          <TableHead>Ticket ID</TableHead>
                          <TableHead>Issue / Title</TableHead>
                          <TableHead>Department</TableHead>
                          <TableHead>Plant</TableHead>
                          <TableHead>Raised By</TableHead>
                          <TableHead>Assigned Technician</TableHead>
                          <TableHead>Target Date</TableHead>
                          <TableHead>Status</TableHead>
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
                  <div className="flex items-center justify-between p-4 border-t">
                    <div className="text-xs text-muted-foreground">
                      Showing {(unassignedPage - 1) * PAGE_SIZE + 1}–{Math.min(unassignedPage * PAGE_SIZE, unassignedCount)} of {unassignedCount} tickets
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={unassignedPage === 1} onClick={() => setUnassignedPage(p => p - 1)}>Previous</Button>
                      <Button variant="outline" size="sm" disabled={unassignedPage >= unassignedPages} onClick={() => setUnassignedPage(p => p + 1)}>Next</Button>
                    </div>
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
