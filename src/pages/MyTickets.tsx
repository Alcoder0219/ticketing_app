import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Filter, Eye, RefreshCw, Search, FileText, Trash2, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useDeleteTicket } from "@/hooks/useDeleteTicket";
import { AgingBadge } from "@/components/AgingBadge";
import { useTicketsRealtime } from "@/hooks/useTicketsRealtime";
import { TicketIdLink } from "@/components/TicketIdLink";
import { SignedImage } from "@/components/SignedMedia";
import { RatingDialog } from "@/components/RatingDialog";
import { formatDate } from "@/utils/dateFormat";

type TabKey = "all" | "pending" | "resolved";

const priorities = ["low", "medium", "high", "critical"];


export default function MyTickets() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { isSuperAdmin, deleteTicket } = useDeleteTicket();
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [ratingTicket, setRatingTicket] = useState<{ id: string; number: string } | null>(null);

  useTicketsRealtime([["my-tickets"]]);


  const { data: tickets, isLoading } = useQuery({
    queryKey: ["my-tickets", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("tickets")
        .select("*, issue_dept:departments!tickets_issue_department_id_fkey(name), unit:units(name), assigned_profile:profiles!tickets_assigned_to_fkey(name)")
        .eq("raised_by", user!.id)
        .order("created_at", { ascending: false });
      const ids = (data || []).map((t: any) => t.id);
      const ratingMap = new Map<string, number>();
      if (ids.length) {
        const { data: ratings } = await supabase
          .from("ticket_ratings")
          .select("ticket_id, rating")
          .in("ticket_id", ids);
        (ratings || []).forEach((r: any) => ratingMap.set(r.ticket_id, r.rating));
      }
      return (data || []).map((t: any) => ({ ...t, _rated: ratingMap.has(t.id), _rating: ratingMap.get(t.id) ?? null }));
    },
    enabled: !!user,
  });

  const counts = useMemo(() => {
    const all = tickets || [];
    return {
      all: all.length,
      pending: all.filter((t) => ["open", "in_progress", "reopened"].includes(t.status)).length,
      resolved: all.filter((t) => ["resolved", "closed"].includes(t.status)).length,
    };
  }, [tickets]);

  const filtered = useMemo(() => {
    return (tickets || []).filter((t) => {
      if (activeTab === "pending" && !["open", "in_progress", "reopened"].includes(t.status)) return false;
      if (activeTab === "resolved" && !["resolved", "closed"].includes(t.status)) return false;
      if (priorityFilter !== "all" && (t as any).priority !== priorityFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!t.title.toLowerCase().includes(q) && !t.ticket_number.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [tickets, activeTab, priorityFilter, search]);

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "pending", label: "Pending", count: counts.pending },
    { key: "resolved", label: "Resolved", count: counts.resolved },
  ];

  return (
    <AppLayout title="My Tickets">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-foreground">My Tickets</h1>
        <div className="flex items-center gap-2">
          <Button onClick={() => navigate("/create-ticket")} className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm">
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon" className="border-border">
                <Filter className="h-4 w-4 text-destructive" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3 space-y-3" align="end">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Search</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input placeholder="Ticket ID or title..." className="pl-8 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Priority</label>
                <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Priorities</SelectItem>
                    {priorities.map((p) => (
                      <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Sidebar tabs */}
        <aside className="col-span-12 md:col-span-2">
          <div className="flex md:flex-col gap-1">
            {tabs.map((t) => {
              const active = activeTab === t.key;
              const activeClass =
                t.key === "pending"
                  ? "bg-amber-50 text-amber-700"
                  : t.key === "resolved"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-muted text-foreground";
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={cn(
                    "flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors w-full text-left",
                    active ? activeClass : "text-muted-foreground hover:bg-muted/60"
                  )}
                >
                  <span>{t.label}</span>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 bg-background/80 text-foreground border">
                    {t.count}
                  </Badge>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Cards grid */}
        <section className="col-span-12 md:col-span-10">
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Card key={i} className="border shadow-sm h-80 animate-pulse">
                  <CardContent className="p-4 space-y-3">
                    <div className="h-4 bg-muted rounded w-1/2" />
                    <div className="h-32 bg-muted rounded" />
                    <div className="h-4 bg-muted rounded w-3/4" />
                    <div className="h-3 bg-muted rounded w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <Card className="border shadow-sm">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <FileText className="h-12 w-12 text-muted-foreground/40 mb-3" />
                <p className="text-muted-foreground mb-3">No tickets found.</p>
                <Button variant="outline" onClick={() => navigate("/create-ticket")}>
                  <Plus className="h-4 w-4 mr-1" /> Create your first ticket
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map((ticket: any) => {
                const isResolved = ["resolved", "closed"].includes(ticket.status);
                const attachments = Array.isArray(ticket.attachments) ? ticket.attachments : [];
                const firstImage = ticket.photo_url || attachments.find((a: any) => typeof a === "string" && /\.(jpg|jpeg|png|webp|gif)$/i.test(a)) || (typeof attachments[0] === "object" ? attachments[0]?.url : attachments[0]);
                const isImage = firstImage && /\.(jpg|jpeg|png|webp|gif)/i.test(firstImage);
                const targetCount = ticket.next_target_date ? 5 : 1;

                return (
                  <Card
                    key={ticket.id}
                    className="border shadow-sm hover:shadow-md transition-shadow cursor-pointer flex flex-col overflow-hidden"
                    onClick={() => navigate(`/ticket/${ticket.id}`)}
                  >
                    {/* Header */}
                    <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-foreground text-sm"><TicketIdLink ticketNumber={ticket.ticket_number}>#{ticket.ticket_number}</TicketIdLink></div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Assigned To - {ticket.assigned_profile?.name || "Unassigned"}
                        </div>
                      </div>
                      {isSuperAdmin && (
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteTicket(ticket.id); }}
                          className="text-destructive hover:bg-destructive/10 rounded p-1 shrink-0"
                          title="Delete ticket"
                          aria-label="Delete ticket"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    {/* Image area */}
                    <div className="px-4">
                      <div className="aspect-[4/3] rounded-md bg-muted/40 border border-border/50 overflow-hidden flex items-center justify-center">
                        {isImage ? (
                          <SignedImage src={firstImage} bucket="ticket-attachments" alt={ticket.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="text-muted-foreground/40 text-xs">No image</div>
                        )}
                      </div>
                    </div>

                    {/* Body */}
                    <div className="px-4 pt-3 pb-2 flex-1 flex flex-col">
                      <h3 className="font-semibold text-foreground text-base leading-snug line-clamp-2">
                        {ticket.title}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Aging -{" "}
                        <AgingBadge
                          createdAt={ticket.created_at}
                          status={ticket.status}
                          resolvedAt={ticket.resolved_at}
                          closedAt={ticket.closed_at}
                        />
                        {" "}/ Target Date - {ticket.target_date ? formatDate(ticket.target_date) : "-"} / Target Date count - ({targetCount})
                      </p>
                      <p className="text-xs text-muted-foreground mt-2 line-clamp-3">
                        Latest Remark: {ticket.remarks || "—"} / Latest Remark Punch On - {formatDate(ticket.updated_at, true)}
                        {isResolved && ticket.closing_remarks ? ` | Remark When Resolved: ${ticket.closing_remarks}` : ""}
                      </p>
                    </div>

                    {/* Footer actions */}
                    <div className="px-4 py-2.5 border-t border-border flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {isResolved ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate(`/ticket/${ticket.id}`); }}
                            className="flex items-center gap-1 text-destructive text-xs font-bold uppercase tracking-wide hover:underline"
                          >
                            <RefreshCw className="h-3.5 w-3.5" /> Re Open
                          </button>
                        ) : (
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {ticket.status.replace("_", " ")}
                          </span>
                        )}
                        {ticket.status === "closed" && !ticket._rated && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setRatingTicket({ id: ticket.id, number: ticket.ticket_number }); }}
                            className="flex items-center gap-1 text-emerald-600 text-xs font-bold uppercase tracking-wide hover:underline"
                          >
                            <Star className="h-3.5 w-3.5 fill-emerald-600" /> Give Rating
                          </button>
                        )}
                        {ticket.status === "closed" && ticket._rated && (
                          <div className="flex items-center gap-0.5" title={`Rated ${ticket._rating}/5`}>
                            {[1,2,3,4,5].map((n) => (
                              <Star
                                key={n}
                                className={cn(
                                  "h-3.5 w-3.5",
                                  n <= (ticket._rating || 0)
                                    ? "fill-amber-400 text-amber-400"
                                    : "text-muted-foreground/30"
                                )}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/ticket/${ticket.id}`); }}
                        className="text-amber-500 hover:text-amber-600"
                        aria-label="View ticket"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </div>
      {ratingTicket && (
        <RatingDialog
          open={!!ratingTicket}
          onOpenChange={(o) => { if (!o) setRatingTicket(null); }}
          ticketId={ratingTicket.id}
          ticketNumber={ratingTicket.number}
          onSubmitted={() => qc.invalidateQueries({ queryKey: ["my-tickets"] })}
        />
      )}
    </AppLayout>
  );
}
