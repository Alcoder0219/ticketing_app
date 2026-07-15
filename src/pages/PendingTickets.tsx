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
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/api/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { statusMap } from "@/lib/mock-data";
import { Search, Clock, UserPlus, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useDeleteTicket } from "@/hooks/useDeleteTicket";
import { AgingBadge, computeAgingDaysForTicket } from "@/components/AgingBadge";
import { AGING_FILTER_OPTIONS, matchesAgingFilter, type AgingFilterValue } from "@/lib/aging";
import { useTicketsRealtime } from "@/hooks/useTicketsRealtime";
import { formatDate } from "@/utils/dateFormat";

export default function PendingTickets() {
  const navigate = useNavigate();
  const { user, profile, role } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [agingFilter, setAgingFilter] = useState<AgingFilterValue>("all");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");

  const { data: departments } = useQuery({
    queryKey: ["departments-with-tickets"],
    queryFn: async () => {
      const { data: ticketDepts } = await supabase
        .from("tickets")
        .select("issue_department_id")
        .not("issue_department_id", "is", null);
      const ids = Array.from(new Set((ticketDepts || []).map((t: any) => t.issue_department_id)));
      if (ids.length === 0) return [];
      const { data } = await supabase
        .from("departments")
        .select("id, name")
        .in("id", ids)
        .order("name");
      return data || [];
    },
  });

  const isSuperOrAdmin = role === "super_admin" || role === "admin";
  const isHOD = role === "hod";
  const { isSuperAdmin, deleteTicket } = useDeleteTicket();

  useTicketsRealtime([["pending-tickets"]]);

  const { data: tickets, isLoading } = useQuery({
    queryKey: ["pending-tickets", user?.id, role, profile?.department_id],
    queryFn: async () => {
      let query = supabase
        .from("tickets")
        .select("*, issue_dept:departments!tickets_issue_department_id_fkey(name), raiser:profiles!tickets_raised_by_fkey(name)")
        .in("status", ["open", "reopened"])
        .order("created_at", { ascending: false });

      if (role === "user") {
        query = query.eq("raised_by", user!.id);
      } else if ((role === "assigned_person" || isHOD) && profile?.department_id) {
        query = query.eq("issue_department_id", profile.department_id);
      }
      // admin/super_admin see all

      const { data } = await query;
      return data || [];
    },
    enabled: !!user,
  });

  // Fetch team members for HOD assign
  const { data: teamMembers } = useQuery({
    queryKey: ["team-members", profile?.department_id],
    queryFn: async () => {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, name")
        .eq("department_id", profile!.department_id!);

      // Filter to only assigned_person roles
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", ["assigned_person"]);

      const roleMap = new Map(roles?.map(r => [r.user_id, r.role]) || []);
      return (profiles || []).filter(p => roleMap.has(p.user_id) && p.user_id !== user!.id);
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

      // Add history
      await supabase.from("ticket_history").insert({
        ticket_id: ticketId,
        performed_by: user!.id,
        action: "Assigned ticket",
        old_status: "open",
        new_status: "in_progress",
      });

      // Notification
      await supabase.from("notifications").insert({
        user_id: assigneeId,
        title: "Ticket Assigned",
        message: "A ticket has been assigned to you.",
        ticket_id: ticketId,
        type: "assignment",
      });
    },
    onSuccess: () => {
      toast({ title: "Ticket Assigned", description: "Ticket has been assigned and moved to In Progress." });
      queryClient.invalidateQueries({ queryKey: ["pending-tickets"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const filtered = (tickets || []).filter((t) => {
    if (agingFilter !== "all" && !matchesAgingFilter(computeAgingDaysForTicket(t as any), agingFilter)) return false;
    if (departmentFilter !== "all" && (t as any).issue_department_id !== departmentFilter) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase()) && !t.ticket_number.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <AppLayout title="Pending Tickets">
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search pending tickets..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments?.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
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
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted text-sm">
            <Clock className="h-4 w-4 text-warning" />
            <span>{filtered.length} pending ticket{filtered.length !== 1 ? "s" : ""}</span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : filtered.length === 0 ? (
          <Card className="border shadow-sm">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Clock className="h-12 w-12 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground">No pending tickets.</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((ticket) => (
            <Card key={ticket.id} className="border shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/ticket/${ticket.id}`)}>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <TicketIdLink ticketNumber={ticket.ticket_number} className="text-xs" />
                      <StatusBadge status={statusMap[ticket.status]} />
                      <PriorityBadge priority={ticket.priority || "medium"} />
                    </div>
                    <h3 className="font-medium text-foreground truncate">{ticket.title}</h3>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span>From: {(ticket as any).raiser?.name || "—"}</span>
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
                  <div className="flex items-center gap-2 shrink-0">
                    {ticket.target_date && (
                      <div className="text-right space-y-1">
                        <p className="text-xs text-muted-foreground">Target: {formatDate(ticket.target_date)}</p>
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
                    {isHOD && !ticket.assigned_to && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button size="sm" variant="outline" className="ml-2">
                            <UserPlus className="h-3.5 w-3.5 mr-1" /> Assign
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-2">
                          <p className="text-xs font-medium mb-2 text-muted-foreground">Assign to team member</p>
                          {teamMembers?.length ? teamMembers.map((m) => (
                            <button
                              key={m.user_id}
                              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-sm text-left"
                              onClick={() => assignMutation.mutate({ ticketId: ticket.id, assigneeId: m.user_id })}
                            >
                              <Avatar className="h-6 w-6">
                                <AvatarFallback className="text-[10px] bg-primary/10 text-primary">{m.name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
                              </Avatar>
                              {m.name}
                            </button>
                          )) : (
                            <p className="text-xs text-muted-foreground py-2">No team members found.</p>
                          )}
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </AppLayout>
  );
}
