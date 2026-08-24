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
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { statusMap } from "@/lib/mock-data";
import { useDeleteTicket } from "@/hooks/useDeleteTicket";
import { AgingBadge } from "@/components/AgingBadge";
import { useTicketsRealtime } from "@/hooks/useTicketsRealtime";
import { TicketIdLink } from "@/components/TicketIdLink";
import { SignedImage } from "@/components/SignedMedia";
import { RatingDialog } from "@/components/RatingDialog";
import { formatDate } from "@/utils/dateFormat";
import { usePagination } from "@/hooks/usePagination";
import { buildPageMeta } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";
import { orIlike } from "@/lib/searchFilter";

type TabKey = "all" | "pending" | "resolved";

const priorities = ["low", "medium", "high", "critical"];

const TICKETS_SELECT =
  "*, issue_dept:departments!tickets_issue_department_id_fkey(name), unit:units(name), assigned_profile:profiles!tickets_assigned_to_fkey(name)";
const PENDING_STATUSES = ["open", "in_progress", "reopened"];
const RESOLVED_STATUSES = ["resolved", "closed"];

export default function MyTickets() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { isSuperAdmin, deleteTicket } = useDeleteTicket();
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [ratingTicket, setRatingTicket] = useState<{ id: string; number: string } | null>(null);

  useTicketsRealtime([["my-tickets"]]);

  const filterKey = JSON.stringify({ activeTab, priorityFilter, search });
  const pagination = usePagination({ resetKey: filterKey });

  /** raised_by + activeTab/priority/search filters, shared by the rows and count queries. */
  function buildTicketsBase() {
    let q: any = supabase.from("tickets").eq("raised_by", user!.id);
    if (activeTab === "pending") q = q.in("status", PENDING_STATUSES);
    else if (activeTab === "resolved") q = q.in("status", RESOLVED_STATUSES);
    if (priorityFilter !== "all") q = q.eq("priority", priorityFilter);
    if (search) q = q.or(orIlike([["title", search], ["ticket_number", search]]));
    return q;
  }

  const { data: filtered = [], isLoading } = useQuery({
    queryKey: ["my-tickets", "rows", user?.id, activeTab, priorityFilter, search, pagination.page],
    queryFn: async () => {
      const { data } = await buildTicketsBase()
        .select(TICKETS_SELECT)
        .order("created_at", { ascending: false })
        .range(pagination.range.from, pagination.range.to);
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

  const { data: filteredCount = 0 } = useQuery({
    queryKey: ["my-tickets", "count", "rows", user?.id, activeTab, priorityFilter, search],
    queryFn: async () => {
      const { count } = await buildTicketsBase().select("id", { head: true, count: "exact" });
      return count ?? 0;
    },
    enabled: !!user,
  });

  // Tab badge counts reflect ALL of the user's tickets per status bucket,
  // independent of the priority/search refinement — same as before pagination.
  const { data: counts = { all: 0, pending: 0, resolved: 0 } } = useQuery({
    queryKey: ["my-tickets", "count", "tabs", user?.id],
    queryFn: async () => {
      const [all, pending, resolved] = await Promise.all([
        supabase.from("tickets").eq("raised_by", user!.id).select("id", { head: true, count: "exact" }),
        supabase.from("tickets").eq("raised_by", user!.id).in("status", PENDING_STATUSES).select("id", { head: true, count: "exact" }),
        supabase.from("tickets").eq("raised_by", user!.id).in("status", RESOLVED_STATUSES).select("id", { head: true, count: "exact" }),
      ]);
      return { all: all.count ?? 0, pending: pending.count ?? 0, resolved: resolved.count ?? 0 };
    },
    enabled: !!user,
  });

  const pageMeta = buildPageMeta(pagination.page, pagination.pageSize, filteredCount);

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "all", label: t("common.all"), count: counts.all },
    { key: "pending", label: t("status.pending"), count: counts.pending },
    { key: "resolved", label: t("status.Resolved"), count: counts.resolved },
  ];

  return (
    <AppLayout title={t("nav.myTickets")}>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-foreground">{t("nav.myTickets")}</h1>
        <div className="flex items-center gap-2">
          <Button onClick={() => navigate("/create-ticket")} className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm">
            <Plus className="h-4 w-4 mr-1" /> {t("common.add")}
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon" className="border-border">
                <Filter className="h-4 w-4 text-destructive" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3 space-y-3" align="end">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("common.search")}</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input placeholder={t("ticket.searchIdOrTitle")} className="pl-8 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("common.priority")}</label>
                <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("common.allPriorities")}</SelectItem>
                    {priorities.map((p) => (
                      <SelectItem key={p} value={p}>{t(`priority.${p}`)}</SelectItem>
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
            {tabs.map((tab) => {
              const active = activeTab === tab.key;
              const activeClass =
                tab.key === "pending"
                  ? "bg-amber-50 text-amber-700"
                  : tab.key === "resolved"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-muted text-foreground";
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors w-full text-left",
                    active ? activeClass : "text-muted-foreground hover:bg-muted/60"
                  )}
                >
                  <span>{tab.label}</span>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 bg-background/80 text-foreground border">
                    {tab.count}
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
                <p className="text-muted-foreground mb-3">{t("ticket.noTickets")}</p>
                <Button variant="outline" onClick={() => navigate("/create-ticket")}>
                  <Plus className="h-4 w-4 mr-1" /> {t("ticket.createFirst")}
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
                          {t("ticket.assignedTo")} - {ticket.assigned_profile?.name || t("ticket.unassigned")}
                        </div>
                      </div>
                      {isSuperAdmin && (
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteTicket(ticket.id); }}
                          className="text-destructive hover:bg-destructive/10 rounded p-1 shrink-0"
                          title={t("ticket.deleteTicket")}
                          aria-label={t("ticket.deleteTicket")}
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
                          <div className="text-muted-foreground/40 text-xs">{t("ticket.noImage")}</div>
                        )}
                      </div>
                    </div>

                    {/* Body */}
                    <div className="px-4 pt-3 pb-2 flex-1 flex flex-col">
                      <h3 className="font-semibold text-foreground text-base leading-snug line-clamp-2">
                        {ticket.title}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        {t("aging.label")} -{" "}
                        <AgingBadge
                          createdAt={ticket.created_at}
                          status={ticket.status}
                          resolvedAt={ticket.resolved_at}
                          closedAt={ticket.closed_at}
                        />
                        {" "}/ {t("ticket.targetDate")} - {ticket.target_date ? formatDate(ticket.target_date) : "-"} / {t("ticket.targetDateCount")} - ({targetCount})
                      </p>
                      <p className="text-xs text-muted-foreground mt-2 line-clamp-3">
                        {t("ticket.latestRemark")}: {ticket.remarks || "—"} / {t("ticket.latestRemarkPunchedOn")} - {formatDate(ticket.updated_at, true)}
                        {isResolved && ticket.closing_remarks ? ` | ${t("ticket.remarkWhenResolved")}: ${ticket.closing_remarks}` : ""}
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
                            <RefreshCw className="h-3.5 w-3.5" /> {t("ticket.reOpen")}
                          </button>
                        ) : (
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {t(`status.${statusMap[ticket.status] ?? ticket.status}`, { defaultValue: ticket.status.replace("_", " ") })}
                          </span>
                        )}
                        {ticket.status === "closed" && !ticket._rated && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setRatingTicket({ id: ticket.id, number: ticket.ticket_number }); }}
                            className="flex items-center gap-1 text-emerald-600 text-xs font-bold uppercase tracking-wide hover:underline"
                          >
                            <Star className="h-3.5 w-3.5 fill-emerald-600" /> {t("ticket.giveRating")}
                          </button>
                        )}
                        {ticket.status === "closed" && ticket._rated && (
                          <div className="flex items-center gap-0.5" title={t("ticket.ratedOutOf", { rating: ticket._rating })}>
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
                        aria-label={t("ticket.viewTicket")}
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </div>
                  </Card>
                );
              })}
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
