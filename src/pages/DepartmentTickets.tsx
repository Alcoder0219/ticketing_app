import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { PriorityBadge } from "@/components/PriorityBadge";
import { SLAIndicator } from "@/components/SLAIndicator";
import { TicketIdLink } from "@/components/TicketIdLink";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/api/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { statusMap } from "@/lib/mock-data";
import { Search, Building2, UserPlus, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useDeleteTicket } from "@/hooks/useDeleteTicket";
import { AgingBadge } from "@/components/AgingBadge";
import { AGING_FILTER_OPTIONS, type AgingFilterValue } from "@/lib/aging";
import { useTicketsRealtime } from "@/hooks/useTicketsRealtime";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/utils/dateFormat";
import { usePagination } from "@/hooks/usePagination";
import { buildPageMeta } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";
import { orIlike } from "@/lib/searchFilter";

const statusTabs = [
  { key: "all", label: "All" },
  { key: "open", label: "Pending" },
  { key: "in_progress", label: "In Progress" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
];

const DEPT_TICKETS_SELECT =
  "*, issue_dept:departments!tickets_issue_department_id_fkey(name), raiser:profiles!tickets_raised_by_fkey(name), assignee:profiles!tickets_assigned_to_fkey(name)";

/** Aging buckets approximated from created_at alone — see PendingTickets.tsx for rationale. */
function applyAgingFilter(q: any, filter: AgingFilterValue) {
  if (filter === "all") return q;
  const now = Date.now();
  const cutoff = (days: number) => new Date(now - days * 86400000).toISOString();
  switch (filter) {
    case "0-2":
      return q.gte("created_at", cutoff(3));
    case "3-7":
      return q.gte("created_at", cutoff(8)).lt("created_at", cutoff(3));
    case "8-14":
      return q.gte("created_at", cutoff(15)).lt("created_at", cutoff(8));
    case "15+":
      return q.lt("created_at", cutoff(15));
  }
}

export default function DepartmentTickets() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, profile, role, allowedUnitNames } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedDept, setSelectedDept] = useState("all");
  const [activeTab, setActiveTab] = useState("all");
  const [agingFilter, setAgingFilter] = useState<AgingFilterValue>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [unitFilter, setUnitFilter] = useState<string>("all");

  const isSuperOrAdmin = role === "super_admin" || role === "admin";
  const isHOD = role === "hod";
  const { isSuperAdmin, deleteTicket } = useDeleteTicket();

  useTicketsRealtime([["dept-tickets"]]);

  const filterKey = JSON.stringify({ selectedDept, activeTab, agingFilter, assigneeFilter, unitFilter, search });
  const pagination = usePagination({ resetKey: filterKey });

  const { data: departments } = useQuery({
    // "active" so this never collides with the unfiltered (active + inactive)
    // "departments" cache entry Settings/Manage Users use for administration.
    queryKey: ["departments", "active"],
    queryFn: async () => {
      const { data } = await supabase.from("departments").select("*").eq("is_active", true).order("name");
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Only offer plants this role may actually read, matching the other pages.
  const { data: units } = useQuery({
    queryKey: ["filter-units", allowedUnitNames?.join(",") ?? "all"],
    queryFn: async () => {
      let q = supabase.from("units").select("id, name").order("name");
      if (allowedUnitNames) q = q.in("name", allowedUnitNames.length ? allowedUnitNames : ["__none__"]);
      const { data } = await q;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // All users with the assignable_person role — scan-free source for the
  // assignee dropdown instead of deriving options from the ticket list.
  const { data: assignableUsers } = useQuery({
    queryKey: ["assignable-users"],
    queryFn: async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "assigned_person");
      const ids = Array.from(new Set((roles || []).map((r: any) => r.user_id)));
      if (!ids.length) return [];
      const { data } = await supabase.from("profiles").select("user_id,name").in("user_id", ids).order("name");
      return data || [];
    },
    staleTime: 60 * 1000,
  });

  /** Role scoping shared by every count/rows query below. */
  function roleScopedBase() {
    let q: any = supabase.from("tickets");
    if (!isSuperOrAdmin && profile?.department_id) q = q.eq("issue_department_id", profile.department_id);
    if (role === "user") q = q.eq("raised_by", user!.id);
    return q;
  }

  /** Role scoping + all UI filters, shared by the rows and count queries. */
  function buildTicketsBase() {
    let q = roleScopedBase();
    if (selectedDept !== "all") q = q.eq("issue_department_id", selectedDept);
    if (unitFilter !== "all") q = q.eq("unit_id", unitFilter);
    if (assigneeFilter === "unassigned") q = q.is("assigned_to", null);
    else if (assigneeFilter !== "all") q = q.eq("assigned_to", assigneeFilter);
    if (activeTab === "open") q = q.in("status", ["open", "reopened"]);
    else if (activeTab !== "all") q = q.eq("status", activeTab);
    q = applyAgingFilter(q, agingFilter);
    if (search) q = q.or(orIlike([["title", search], ["ticket_number", search]]));
    return q;
  }

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["dept-tickets", "rows", isSuperOrAdmin, profile?.department_id, role, selectedDept, activeTab, agingFilter, assigneeFilter, unitFilter, search, pagination.page],
    queryFn: async () => {
      const { data } = await buildTicketsBase()
        .select(DEPT_TICKETS_SELECT)
        .order("created_at", { ascending: false })
        .range(pagination.range.from, pagination.range.to);
      return data || [];
    },
    enabled: !!user,
  });

  const { data: filteredCount = 0 } = useQuery({
    queryKey: ["dept-tickets", "count", isSuperOrAdmin, profile?.department_id, role, selectedDept, activeTab, agingFilter, assigneeFilter, unitFilter, search],
    queryFn: async () => {
      const { count } = await buildTicketsBase().select("id", { head: true, count: "exact" });
      return count ?? 0;
    },
    enabled: !!user,
  });

  // Status-tab badge counts — scoped by role + selectedDept only, independent
  // of unit/assignee/aging/search, matching the pre-pagination behavior.
  const { data: tabCounts = { all: 0, open: 0, in_progress: 0, resolved: 0, closed: 0 } } = useQuery({
    queryKey: ["dept-tickets", "tab-counts", isSuperOrAdmin, profile?.department_id, role, selectedDept],
    queryFn: async () => {
      const base = () => {
        let q = roleScopedBase();
        if (selectedDept !== "all") q = q.eq("issue_department_id", selectedDept);
        return q;
      };
      const [all, open, inProgress, resolved, closed] = await Promise.all([
        base().select("id", { head: true, count: "exact" }),
        base().in("status", ["open", "reopened"]).select("id", { head: true, count: "exact" }),
        base().eq("status", "in_progress").select("id", { head: true, count: "exact" }),
        base().eq("status", "resolved").select("id", { head: true, count: "exact" }),
        base().eq("status", "closed").select("id", { head: true, count: "exact" }),
      ]);
      return {
        all: all.count ?? 0,
        open: open.count ?? 0,
        in_progress: inProgress.count ?? 0,
        resolved: resolved.count ?? 0,
        closed: closed.count ?? 0,
      };
    },
    enabled: !!user,
  });

  // Sidebar department counts — admin/super_admin only (the sidebar itself
  // is gated the same way), one small indexed count per department.
  const { data: deptCountsData } = useQuery({
    queryKey: ["dept-tickets", "dept-counts", (departments || []).map((d: any) => d.id).join(",")],
    queryFn: async () => {
      const [allRes, ...perDept] = await Promise.all([
        supabase.from("tickets").select("id", { head: true, count: "exact" }),
        ...(departments || []).map((d: any) =>
          supabase.from("tickets").eq("issue_department_id", d.id).select("id", { head: true, count: "exact" }),
        ),
      ]);
      const byDept: Record<string, number> = {};
      (departments || []).forEach((d: any, i: number) => { byDept[d.id] = perDept[i].count ?? 0; });
      return { all: allRes.count ?? 0, byDept };
    },
    enabled: isSuperOrAdmin && !!departments && departments.length > 0,
  });
  const deptCounts = deptCountsData?.byDept ?? {};

  // Team members for HOD assign
  const { data: teamMembers } = useQuery({
    queryKey: ["team-members-dept", profile?.department_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, name")
        .eq("department_id", profile!.department_id!);
      return data || [];
    },
    enabled: isHOD && !!profile?.department_id,
    staleTime: 60 * 1000,
  });

  const assignMutation = useMutation({
    mutationFn: async ({ ticketId, assigneeId }: { ticketId: string; assigneeId: string }) => {
      const { error } = await supabase
        .from("tickets")
        .update({ assigned_to: assigneeId, status: "in_progress", assigned_at: new Date().toISOString() })
        .eq("id", ticketId);
      if (error) throw error;
      await supabase.from("ticket_history").insert({
        ticket_id: ticketId,
        performed_by: user!.id,
        action: "Assigned ticket",
        old_status: "open",
        new_status: "in_progress",
      });
      await supabase.from("notifications").insert({
        user_id: assigneeId,
        title: "Ticket Assigned",
        message: "A ticket has been assigned to you.",
        ticket_id: ticketId,
        type: "assignment",
      });
    },
    onSuccess: () => {
      toast({ title: "Ticket Assigned" });
      queryClient.invalidateQueries({ queryKey: ["dept-tickets"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const filtered = tickets;
  const pageMeta = buildPageMeta(pagination.page, pagination.pageSize, filteredCount);

  return (
    <AppLayout title={t("nav.departmentTickets")}>
      <div className="flex gap-6 w-full min-w-0 overflow-x-hidden">
        {/* Department tree sidebar */}
        {isSuperOrAdmin && (
          <div className="w-56 shrink-0 hidden lg:block">
            <Card className="border shadow-sm sticky top-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("common.department")}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <button
                  className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:bg-muted/50 transition-colors ${selectedDept === "all" ? "border-l-2 border-primary bg-primary/5 font-medium" : ""}`}
                  onClick={() => setSelectedDept("all")}
                >
                  <span>{t("common.allDepartments")}</span>
                  <Badge variant="secondary" className="text-xs">{deptCountsData?.all ?? 0}</Badge>
                </button>
                {departments?.map(d => (
                  <button
                    key={d.id}
                    className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:bg-muted/50 transition-colors ${selectedDept === d.id ? "border-l-2 border-primary bg-primary/5 font-medium" : ""}`}
                    onClick={() => setSelectedDept(d.id)}
                  >
                    <span className="truncate">{d.name}</span>
                    <Badge variant="secondary" className="text-xs">{deptCounts[d.id] || 0}</Badge>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 min-w-0 w-full space-y-4">
          <div className="flex flex-wrap gap-2 items-center w-full">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder={t("ticket.searchTickets")} className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={unitFilter} onValueChange={setUnitFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t("common.unit")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common.allUnits")}</SelectItem>
                {units?.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder={t("common.assignedPerson")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common.allAssignees")}</SelectItem>
                <SelectItem value="unassigned">{t("ticket.unassigned")}</SelectItem>
                {(assignableUsers || []).map((a: any) => (
                  <SelectItem key={a.user_id} value={a.user_id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={agingFilter} onValueChange={(v) => setAgingFilter(v as AgingFilterValue)}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder={t("aging.label")} />
              </SelectTrigger>
              <SelectContent>
                {AGING_FILTER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{t(`aging.filter.${o.value}`, { defaultValue: o.label })}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Status sub-tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full justify-start">
              {statusTabs.map(tab => (
                <TabsTrigger key={tab.key} value={tab.key} className="gap-1.5">
                  {tab.label}
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 min-w-[20px]">{tabCounts[tab.key] || 0}</Badge>
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value={activeTab} className="mt-4">
              {isLoading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
                </div>
              ) : filteredCount === 0 ? (
                <Card className="border shadow-sm">
                  <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                    <Building2 className="h-10 w-10 text-muted-foreground mb-3" />
                    <p className="text-muted-foreground">No tickets found.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2 w-full">
                  {filtered.map((ticket) => (
                    <Card key={ticket.id} className="border shadow-sm hover:shadow-md transition-shadow w-full">
                      <CardContent className="p-4">
                        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 w-full min-w-0">
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/ticket/${ticket.id}`)}>
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <TicketIdLink ticketNumber={ticket.ticket_number} className="text-xs" />
                              <StatusBadge status={statusMap[ticket.status]} />
                              <PriorityBadge priority={ticket.priority || "medium"} />
                            </div>
                            <h3 className="text-sm font-medium text-foreground truncate">{ticket.title}</h3>
                            <div className="flex items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-muted-foreground flex-wrap min-w-0">
                              <span className="truncate">From: {(ticket as any).raiser?.name || "—"}</span>
                              <span className="truncate">Dept: {(ticket as any).issue_dept?.name || "—"}</span>
                              {(ticket as any).assignee?.name && <span className="truncate">Assigned: {(ticket as any).assignee.name}</span>}
                              <span className="flex items-center gap-1">
                                Aging:{" "}
                                <AgingBadge
                                  createdAt={ticket.created_at}
                                  status={ticket.status}
                                  resolvedAt={(ticket as any).resolved_at}
                                  closedAt={ticket.closed_at}
                                />
                              </span>
                              <span>{formatDate(ticket.created_at)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-auto" onClick={e => e.stopPropagation()}>
                            {ticket.target_date && <SLAIndicator targetDate={ticket.target_date} nextTargetDate={ticket.next_target_date} status={ticket.status} />}
                            {isSuperAdmin && (
                              <button
                                onClick={(e) => { e.stopPropagation(); deleteTicket(ticket.id); }}
                                className="text-destructive hover:bg-destructive/10 rounded p-1.5"
                                title={t("ticket.deleteTicket")}
                                aria-label="Delete ticket"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                            {isHOD && !ticket.assigned_to && (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button size="sm" variant="outline">
                                    <UserPlus className="h-3.5 w-3.5 mr-1" /> Assign
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-56 p-2">
                                  <p className="text-xs font-medium mb-2 text-muted-foreground">{t("ticket.assignToTeamMember")}</p>
                                  {teamMembers?.map(m => (
                                    <button
                                      key={m.user_id}
                                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-sm text-left"
                                      onClick={() => assignMutation.mutate({ ticketId: ticket.id, assigneeId: m.user_id })}
                                    >
                                      <Avatar className="h-6 w-6">
                                        <AvatarFallback className="text-[10px] bg-primary/10 text-primary">{m.name.split(" ").map((n: string) => n[0]).join("")}</AvatarFallback>
                                      </Avatar>
                                      {m.name}
                                    </button>
                                  ))}
                                </PopoverContent>
                              </Popover>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
              {filteredCount > 0 && (
                <div className="mt-4">
                  <PaginationControls
                    meta={pageMeta}
                    onPageChange={pagination.setPage}
                    isLoading={isLoading}
                    label="tickets"
                  />
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}
