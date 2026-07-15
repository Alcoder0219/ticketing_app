import { useState } from "react";
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
import { AgingBadge, computeAgingDaysForTicket } from "@/components/AgingBadge";
import { AGING_FILTER_OPTIONS, matchesAgingFilter, type AgingFilterValue } from "@/lib/aging";
import { useTicketsRealtime } from "@/hooks/useTicketsRealtime";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/utils/dateFormat";

const statusTabs = [
  { key: "all", label: "All" },
  { key: "open", label: "Pending" },
  { key: "in_progress", label: "In Progress" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
];

export default function DepartmentTickets() {
  const navigate = useNavigate();
  const { user, profile, role } = useAuth();
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

  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data } = await supabase.from("departments").select("*").eq("is_active", true).order("name");
      return data || [];
    },
  });

  const { data: units } = useQuery({
    queryKey: ["units-all"],
    queryFn: async () => {
      const { data } = await supabase.from("units").select("id, name").order("name");
      return data || [];
    },
  });

  const { data: tickets, isLoading } = useQuery({
    queryKey: ["dept-tickets", isSuperOrAdmin, profile?.department_id, role],
    queryFn: async () => {
      let query = supabase
        .from("tickets")
        .select("*, issue_dept:departments!tickets_issue_department_id_fkey(name), raiser:profiles!tickets_raised_by_fkey(name), assignee:profiles!tickets_assigned_to_fkey(name)")
        .order("created_at", { ascending: false });

      if (!isSuperOrAdmin && profile?.department_id) {
        query = query.eq("issue_department_id", profile.department_id);
      }
      if (role === "user") {
        query = query.eq("raised_by", user!.id);
      }

      const { data } = await query;
      return data || [];
    },
    enabled: !!user,
  });

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

  const allTickets = tickets || [];

  // Filter
  const filtered = allTickets.filter((t) => {
    if (selectedDept !== "all" && t.issue_department_id !== selectedDept) return false;
    if (unitFilter !== "all" && (t as any).unit_id !== unitFilter) return false;
    if (assigneeFilter !== "all") {
      if (assigneeFilter === "unassigned" ? !!t.assigned_to : t.assigned_to !== assigneeFilter) return false;
    }
    if (activeTab !== "all") {
      if (activeTab === "open" && !["open", "reopened"].includes(t.status)) return false;
      if (activeTab !== "open" && t.status !== activeTab) return false;
    }
    if (agingFilter !== "all" && !matchesAgingFilter(computeAgingDaysForTicket(t as any), agingFilter)) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase()) && !t.ticket_number.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Unique assignees from tickets
  const assigneeOptions = Array.from(
    new Map(
      allTickets
        .filter((t) => t.assigned_to && (t as any).assignee?.name)
        .map((t) => [t.assigned_to as string, (t as any).assignee.name as string])
    ).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  // Department counts for sidebar
  const deptCounts: Record<string, number> = {};
  allTickets.forEach(t => {
    const id = t.issue_department_id || "none";
    deptCounts[id] = (deptCounts[id] || 0) + 1;
  });

  // Tab counts
  const tabCounts: Record<string, number> = {
    all: allTickets.filter(t => selectedDept === "all" || t.issue_department_id === selectedDept).length,
    open: allTickets.filter(t => ["open", "reopened"].includes(t.status) && (selectedDept === "all" || t.issue_department_id === selectedDept)).length,
    in_progress: allTickets.filter(t => t.status === "in_progress" && (selectedDept === "all" || t.issue_department_id === selectedDept)).length,
    resolved: allTickets.filter(t => t.status === "resolved" && (selectedDept === "all" || t.issue_department_id === selectedDept)).length,
    closed: allTickets.filter(t => t.status === "closed" && (selectedDept === "all" || t.issue_department_id === selectedDept)).length,
  };

  return (
    <AppLayout title="Department Tickets">
      <div className="flex gap-6 w-full min-w-0 overflow-x-hidden">
        {/* Department tree sidebar */}
        {isSuperOrAdmin && (
          <div className="w-56 shrink-0 hidden lg:block">
            <Card className="border shadow-sm sticky top-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Departments</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <button
                  className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:bg-muted/50 transition-colors ${selectedDept === "all" ? "border-l-2 border-primary bg-primary/5 font-medium" : ""}`}
                  onClick={() => setSelectedDept("all")}
                >
                  <span>All Departments</span>
                  <Badge variant="secondary" className="text-xs">{allTickets.length}</Badge>
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
              <Input placeholder="Search tickets..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={unitFilter} onValueChange={setUnitFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Unit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Units</SelectItem>
                {units?.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Assignee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Assignees</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {assigneeOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={agingFilter} onValueChange={(v) => setAgingFilter(v as AgingFilterValue)}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Aging" />
              </SelectTrigger>
              <SelectContent>
                {AGING_FILTER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
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
              ) : filtered.length === 0 ? (
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
                                title="Delete ticket"
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
                                  <p className="text-xs font-medium mb-2 text-muted-foreground">Assign to team member</p>
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
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}
