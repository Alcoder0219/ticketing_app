import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { PriorityBadge } from "@/components/PriorityBadge";
import { SLAIndicator } from "@/components/SLAIndicator";
import { TicketIdLink } from "@/components/TicketIdLink";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/api/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { statusMap } from "@/lib/mock-data";
import { Search, Filter, ClipboardList, UserPlus, ChevronDown, AlertTriangle, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useDeleteTicket } from "@/hooks/useDeleteTicket";
import { AgingBadge, computeAgingDaysForTicket } from "@/components/AgingBadge";
import { AGING_FILTER_OPTIONS, matchesAgingFilter, type AgingFilterValue } from "@/lib/aging";
import { useTicketsRealtime } from "@/hooks/useTicketsRealtime";

const statuses = ["open", "in_progress", "resolved", "closed", "reopened"];

export default function AssignedTickets() {
  const navigate = useNavigate();
  const { user, profile, role } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");
  const [agingFilter, setAgingFilter] = useState<AgingFilterValue>("all");

  useTicketsRealtime([["assigned-tickets"]]);

  const isTeamMember = role === "assigned_person";
  const isHOD = role === "hod";
  const isSuperOrAdmin = role === "super_admin" || role === "admin";
  const { isSuperAdmin, deleteTicket } = useDeleteTicket();

  const { data: tickets, isLoading } = useQuery({
    queryKey: ["assigned-tickets", user?.id, role, profile?.department_id],
    queryFn: async () => {
      let query = supabase
        .from("tickets")
        .select("*, issue_dept:departments!tickets_issue_department_id_fkey(name), raiser:profiles!tickets_raised_by_fkey(name), assignee:profiles!tickets_assigned_to_fkey(name), unit:units(name)")
        .not("assigned_to", "is", null)
        .order("created_at", { ascending: false });

      if (isTeamMember) {
        query = query.eq("assigned_to", user!.id);
      } else if (isHOD && profile?.department_id) {
        query = query.eq("issue_department_id", profile.department_id);
      }
      // admin/super_admin see all

      const { data } = await query;
      return data || [];
    },
    enabled: !!user,
  });

  // Team members for HOD reassign
  const { data: teamMembers } = useQuery({
    queryKey: ["team-members-assign", profile?.department_id],
    queryFn: async () => {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, name")
        .eq("department_id", profile!.department_id!);
      return profiles || [];
    },
    enabled: (isHOD || isSuperOrAdmin) && !!profile?.department_id,
  });

  const reassignMutation = useMutation({
    mutationFn: async ({ ticketId, assigneeId }: { ticketId: string; assigneeId: string }) => {
      const { error } = await supabase
        .from("tickets")
        .update({ assigned_to: assigneeId, assigned_at: new Date().toISOString() })
        .eq("id", ticketId);
      if (error) throw error;
      await supabase.from("ticket_history").insert({
        ticket_id: ticketId,
        performed_by: user!.id,
        action: "Reassigned ticket",
      });
      await supabase.from("notifications").insert({
        user_id: assigneeId,
        title: "Ticket Reassigned",
        message: "A ticket has been reassigned to you.",
        ticket_id: ticketId,
        type: "assignment",
      });
    },
    onSuccess: () => {
      toast({ title: "Ticket Reassigned" });
      queryClient.invalidateQueries({ queryKey: ["assigned-tickets"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const allTickets = tickets || [];
  const deptOptions = Array.from(new Set(allTickets.map(t => (t as any).issue_dept?.name).filter(Boolean))) as string[];
  const assigneeOptions = Array.from(new Set(allTickets.map(t => (t as any).assignee?.name).filter(Boolean))) as string[];
  const unitOptions = Array.from(new Set(allTickets.map(t => (t as any).unit?.name).filter(Boolean))) as string[];
  const filtered = allTickets.filter((t) => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (deptFilter !== "all" && (t as any).issue_dept?.name !== deptFilter) return false;
    if (assigneeFilter !== "all" && (t as any).assignee?.name !== assigneeFilter) return false;
    if (unitFilter !== "all" && (t as any).unit?.name !== unitFilter) return false;
    if (agingFilter !== "all" && !matchesAgingFilter(computeAgingDaysForTicket(t as any), agingFilter)) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase()) && !t.ticket_number.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const overdueCount = allTickets.filter(t => t.target_date && new Date(t.target_date) < new Date() && !["closed", "resolved"].includes(t.status)).length;

  // HOD view: group by assignee
  const groupedByAssignee: Record<string, typeof filtered> = {};
  if (isHOD) {
    filtered.forEach(t => {
      const name = (t as any).assignee?.name || "Unassigned";
      if (!groupedByAssignee[name]) groupedByAssignee[name] = [];
      groupedByAssignee[name].push(t);
    });
  }

  const renderTicketCard = (ticket: any, showReassign = false) => (
    <div key={ticket.id} className="px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors flex items-center justify-between gap-4 border-b last:border-b-0" onClick={() => navigate(`/ticket/${ticket.id}`)}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <TicketIdLink ticketNumber={ticket.ticket_number} className="text-xs" />
          <StatusBadge status={statusMap[ticket.status]} />
          <PriorityBadge priority={ticket.priority || "medium"} />
        </div>
        <h3 className="text-sm font-medium text-foreground truncate">{ticket.title}</h3>
        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
          <span>From: {(ticket as any).raiser?.name || "—"}</span>
          {!isTeamMember && <span>Assigned: {(ticket as any).assignee?.name || "—"}</span>}
          <span>Dept: {(ticket as any).issue_dept?.name || "—"}</span>
          <span>
            Aging:{" "}
            <AgingBadge
              createdAt={ticket.created_at}
              status={ticket.status}
              resolvedAt={(ticket as any).resolved_at}
              closedAt={ticket.closed_at}
            />
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
        {ticket.target_date && (
          <div className="text-right space-y-1">
            <SLAIndicator targetDate={ticket.target_date} nextTargetDate={ticket.next_target_date} status={ticket.status} />
          </div>
        )}
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
        {showReassign && (
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="ml-2">
                <UserPlus className="h-3.5 w-3.5 mr-1" /> Reassign
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2">
              <p className="text-xs font-medium mb-2 text-muted-foreground">Reassign to</p>
              {teamMembers?.map(m => (
                <button
                  key={m.user_id}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-sm text-left"
                  onClick={() => reassignMutation.mutate({ ticketId: ticket.id, assigneeId: m.user_id })}
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
  );

  return (
    <AppLayout title="Assigned Tickets">
      <div className="space-y-4">
        {/* Summary bar for team member */}
        {isTeamMember && (
          <div className="flex items-center gap-4 p-3 rounded-lg bg-primary/5 border border-primary/20">
            <span className="text-sm font-medium">You have <strong>{allTickets.length}</strong> assigned ticket{allTickets.length !== 1 ? "s" : ""}</span>
            {overdueCount > 0 && (
              <span className="flex items-center gap-1 text-sm text-destructive font-medium">
                <AlertTriangle className="h-3.5 w-3.5" /> {overdueCount} overdue
              </span>
            )}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search tickets..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {statuses.map((s) => (
                <SelectItem key={s} value={s}>{statusMap[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="w-48">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {deptOptions.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger className="w-48">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Assigned Person" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Assignees</SelectItem>
              {assigneeOptions.map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={unitFilter} onValueChange={setUnitFilter}>
            <SelectTrigger className="w-40">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Unit" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Units</SelectItem>
              {unitOptions.map((u) => (
                <SelectItem key={u} value={u}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={agingFilter} onValueChange={(v) => setAgingFilter(v as AgingFilterValue)}>
            <SelectTrigger className="w-44">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Aging" />
            </SelectTrigger>
            <SelectContent>
              {AGING_FILTER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>


        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : filtered.length === 0 ? (
          <Card className="border shadow-sm">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <ClipboardList className="h-12 w-12 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground">No assigned tickets found.</p>
            </CardContent>
          </Card>
        ) : isHOD ? (
          // HOD view: grouped by assignee
          Object.entries(groupedByAssignee).sort(([a], [b]) => a.localeCompare(b)).map(([name, tickets]) => (
            <Collapsible key={name} defaultOpen>
              <Card className="border shadow-sm">
                <CollapsibleTrigger className="w-full">
                  <div className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="text-[10px] bg-primary/10 text-primary">{name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium text-sm">{name}</span>
                      <Badge variant="secondary" className="text-xs">{tickets.length}</Badge>
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {tickets.map(t => renderTicketCard(t, true))}
                </CollapsibleContent>
              </Card>
            </Collapsible>
          ))
        ) : (
          // Team member / Admin / Super Admin: flat list
          <Card className="border shadow-sm">
            <CardContent className="p-0">
              {filtered.map(t => renderTicketCard(t, isHOD || isSuperOrAdmin))}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
