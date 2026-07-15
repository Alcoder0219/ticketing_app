import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { PriorityBadge } from "@/components/PriorityBadge";
import { AgingBadge } from "@/components/AgingBadge";
import { TicketChatThread } from "@/components/TicketChatThread";
import { statusMap } from "@/lib/mock-data";
import { SignedImage, SignedAudio, SignedLink } from "@/components/SignedMedia";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Copy, Link2, Printer, ExternalLink, AlertTriangle, Search,
  Mic, FileText, Image as ImageIcon, Download, CheckCircle2, UserPlus, Clock,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { formatDate } from "@/utils/dateFormat";

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(" ").filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
}

function fmt(d?: string | null) {
  if (!d) return "—";
  return formatDate(d, true);
}

function isImageUrl(url: string) {
  return /\.(jpg|jpeg|png|webp|gif|bmp|svg)(\?|$)/i.test(url);
}

function SlaBar({ createdAt, slaDueAt, status }: { createdAt: string; slaDueAt?: string | null; status: string }) {
  if (!slaDueAt) return null;
  const isClosed = ["resolved", "closed"].includes(status);
  const start = new Date(createdAt).getTime();
  const end = new Date(slaDueAt).getTime();
  const now = Date.now();
  const total = end - start;
  const used = Math.min(Math.max((now - start) / total, 0), 1.5);
  const pct = Math.min(used * 100, 100);
  const breached = now > end && !isClosed;
  const color = breached || used > 0.8 ? "bg-red-500" : used > 0.5 ? "bg-amber-500" : "bg-emerald-500";
  const hoursRemaining = Math.round((end - now) / (1000 * 60 * 60));
  return (
    <div className="space-y-1.5">
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{Math.round(used * 100)}% of SLA window used</span>
        {breached ? (
          <span className="text-red-600 font-semibold inline-flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Breached {Math.abs(hoursRemaining)}h ago
          </span>
        ) : isClosed ? (
          <span className="text-muted-foreground">Closed</span>
        ) : (
          <span className="text-muted-foreground">Due {fmt(slaDueAt)} · {hoursRemaining}h left</span>
        )}
      </div>
    </div>
  );
}

function PersonCard({ label, name, employeeId, contact, department, missingLabel }: {
  label: string; name?: string | null; employeeId?: string | null; contact?: string | null; department?: string | null; missingLabel?: string;
}) {
  if (!name) {
    return (
      <div className="rounded-lg border bg-muted/40 p-3">
        <p className="text-[10px] font-bold tracking-wider text-muted-foreground mb-1">{label}</p>
        <p className="text-sm text-amber-600 inline-flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" /> {missingLabel || "Not assigned yet"}
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <p className="text-[10px] font-bold tracking-wider text-muted-foreground mb-2">{label}</p>
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-semibold text-sm shrink-0">
          {initials(name)}
        </div>
        <div className="min-w-0 text-xs space-y-0.5">
          <p className="text-sm font-semibold text-foreground">{name}</p>
          {employeeId && <p className="text-muted-foreground">ID: {employeeId}</p>}
          {contact && <p className="text-muted-foreground">{contact}</p>}
          {department && <p className="text-muted-foreground">{department}</p>}
        </div>
      </div>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-4 p-1">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-6 w-full" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
      </div>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

interface PanelInnerProps {
  ticketKey: string;
  onClose: () => void;
}

function PanelInner({ ticketKey, onClose }: PanelInnerProps) {
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const { toast } = useToast();
  const [lightbox, setLightbox] = useState<string | null>(null);

  const { data: ticket, isLoading, isError, refetch } = useQuery({
    queryKey: ["ticket-panel", ticketKey],
    queryFn: async () => {
      const select = "*, issue_dept:departments!tickets_issue_department_id_fkey(name), unit:units(name), raiser:profiles!tickets_raised_by_fkey(name, employee_id, contact), assigned_profile:profiles!tickets_assigned_to_fkey(name, employee_id, contact)";
      // Try by uuid first if it looks like one, otherwise by ticket_number
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ticketKey);
      const col = isUuid ? "id" : "ticket_number";
      const { data, error } = await supabase.from("tickets").select(select).eq(col, ticketKey).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!ticketKey,
    retry: 1,
  });

  const { data: resolver } = useQuery({
    queryKey: ["ticket-panel-resolver", (ticket as any)?.resolved_by],
    queryFn: async () => {
      const rid = (ticket as any)?.resolved_by;
      const { data } = await supabase.from("profiles").select("name, employee_id").eq("user_id", rid).maybeSingle();
      return data;
    },
    enabled: !!(ticket as any)?.resolved_by,
  });

  const { data: timeline } = useQuery({
    queryKey: ["ticket-panel-timeline", (ticket as any)?.id],
    queryFn: async () => {
      const tid = (ticket as any)?.id;
      const { data } = await supabase
        .from("ticket_history")
        .select("*, performer:profiles!ticket_history_performed_by_fkey(name)")
        .eq("ticket_id", tid)
        .order("created_at", { ascending: true });
      return data || [];
    },
    enabled: !!(ticket as any)?.id,
  });

  if (isLoading) return <PanelSkeleton />;

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-4">
        <AlertTriangle className="h-10 w-10 text-amber-500 mb-3" />
        <p className="text-base font-semibold">Could not load ticket details</p>
        <p className="text-sm text-muted-foreground mb-4">Check your connection and try again.</p>
        <Button onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-4">
        <Search className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="text-base font-semibold">Ticket not found</p>
        <p className="text-sm text-muted-foreground mb-4">
          {ticketKey} does not exist or you do not have permission to view it.
        </p>
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    );
  }

  const t: any = { ...ticket, resolver };
  const isElevated = role === "super_admin" || role === "admin";
  const isHOD = role === "hod" || isElevated;
  const isAssigned = t.assigned_to === user?.id;
  const isRaiser = t.raised_by === user?.id;
  const canSeeSensitive = isElevated || isHOD || isAssigned || isRaiser;

  const attachments: string[] = Array.isArray(t.attachments)
    ? t.attachments.map((a: any) => (typeof a === "string" ? a : a?.url)).filter(Boolean)
    : [];
  const resolutionPhotos: string[] = Array.isArray(t.resolution_photos) ? t.resolution_photos : [];

  const copyId = () => {
    navigator.clipboard.writeText(t.ticket_number);
    toast({ title: "Copied", description: t.ticket_number });
  };
  const copyLink = () => {
    const url = `${window.location.origin}${window.location.pathname}?ticket=${t.ticket_number}`;
    navigator.clipboard.writeText(url);
    toast({ title: "Link copied" });
  };

  return (
    <div className="space-y-5 pb-24">
      {/* Header */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xl font-bold text-blue-600">{t.ticket_number}</span>
          <StatusBadge status={statusMap[t.status]} />
          <PriorityBadge priority={t.priority || "medium"} />
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={copyId} title="Copy ticket ID">
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
        <h2 className="text-base font-bold leading-snug">{t.title}</h2>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={() => navigate(`/ticket/${t.id}`)}>
            <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open Full View
          </Button>
          <Button size="sm" variant="outline" onClick={copyLink}>
            <Link2 className="h-3.5 w-3.5 mr-1" /> Copy Link
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5 mr-1" /> Print
          </Button>
          {(isHOD || isElevated) && !["resolved", "closed"].includes(t.status) && (
            <Button size="sm" variant="outline" onClick={() => navigate(`/ticket/${t.id}`)}>
              <UserPlus className="h-3.5 w-3.5 mr-1" /> Reassign
            </Button>
          )}
          {isAssigned && t.status === "in_progress" && (
            <Button size="sm" onClick={() => navigate(`/ticket/${t.id}`)}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Resolve
            </Button>
          )}
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg border bg-card p-3 text-xs">
        <InfoRow label="Ticket ID" value={t.ticket_number} mono />
        <InfoRow label="Department" value={t.issue_dept?.name || "—"} />
        <InfoRow label="Created On" value={fmt(t.created_at)} />
        <InfoRow label="Plant / Unit" value={t.unit?.name || "—"} />
        <InfoRow label="Aging" value={
          <AgingBadge createdAt={t.created_at} status={t.status} resolvedAt={t.resolved_at} closedAt={t.closed_at} />
        } />
        <InfoRow label="Priority" value={<PriorityBadge priority={t.priority || "medium"} />} />
        <InfoRow label="Target Date" value={t.target_date ? formatDate(t.target_date) : "Not set"} />
        <InfoRow label="Status" value={<StatusBadge status={statusMap[t.status]} />} />
        <InfoRow label="Last Updated" value={t.updated_at ? formatDistanceToNow(new Date(t.updated_at), { addSuffix: true }) : "—"} />
        <InfoRow label="SLA Due" value={t.sla_due_at ? fmt(t.sla_due_at) : "—"} />
      </div>

      {/* SLA bar */}
      {t.sla_due_at && (
        <div>
          <p className="text-[11px] font-bold tracking-wider text-muted-foreground mb-2">SLA STATUS</p>
          <SlaBar createdAt={t.created_at} slaDueAt={t.sla_due_at} status={t.status} />
        </div>
      )}

      {/* People */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PersonCard
          label="RAISED BY"
          name={t.raiser?.name}
          employeeId={t.raiser?.employee_id}
          contact={t.raiser?.contact}
        />
        <PersonCard
          label="ASSIGNED TECHNICIAN"
          name={t.assigned_profile?.name}
          employeeId={t.assigned_profile?.employee_id}
          contact={t.assigned_profile?.contact}
          missingLabel="Not Assigned Yet"
        />
      </div>

      {/* Description */}
      <div>
        <p className="text-[11px] font-bold tracking-wider text-muted-foreground mb-1.5">DESCRIPTION</p>
        <div className="rounded-lg border bg-card p-3 text-sm whitespace-pre-wrap leading-relaxed">
          {t.description || <span className="text-muted-foreground italic">No description provided.</span>}
        </div>
      </div>

      {/* Voice */}
      {t.voice_recording_url && canSeeSensitive && (
        <div>
          <p className="text-[11px] font-bold tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
            <Mic className="h-3.5 w-3.5" /> VOICE RECORDING
          </p>
          <div className="rounded-lg border bg-card p-3 space-y-2">
            <SignedAudio controls src={t.voice_recording_url} bucket="ticket-attachments" className="w-full" />
            <p className="text-xs text-muted-foreground">
              Recorded by {t.raiser?.name || "—"} on {fmt(t.created_at)}
            </p>
          </div>
        </div>
      )}

      {/* Attachments */}
      {attachments.length > 0 && (
        <div>
          <p className="text-[11px] font-bold tracking-wider text-muted-foreground mb-2">
            ATTACHMENTS ({attachments.length})
          </p>
          <div className="grid grid-cols-3 gap-2">
            {attachments.map((url, i) => (
              <AttachmentTile key={i} url={url} onPreview={setLightbox} />
            ))}
          </div>
        </div>
      )}

      {/* Resolution proof */}
      {resolutionPhotos.length > 0 && canSeeSensitive && (
        <div>
          <p className="text-[11px] font-bold tracking-wider text-muted-foreground mb-1">
            ✅ RESOLUTION PROOF
          </p>
          <p className="text-xs text-muted-foreground mb-2">
            Resolved by {t.resolver?.name || "—"} on {fmt(t.resolved_at)}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {resolutionPhotos.map((url, i) => (
              <AttachmentTile key={i} url={url} onPreview={setLightbox} />
            ))}
          </div>
          {t.resolution_note && (
            <p className="mt-2 text-sm rounded-lg border bg-card p-3 whitespace-pre-wrap">{t.resolution_note}</p>
          )}
        </div>
      )}

      {/* Timeline */}
      <div>
        <p className="text-[11px] font-bold tracking-wider text-muted-foreground mb-2">ACTIVITY TIMELINE</p>
        <div className="space-y-2.5 rounded-lg border bg-card p-3">
          <TimelineItem icon="🎫" text={`Ticket created by ${t.raiser?.name || "—"}`} when={t.created_at} />
          {(timeline || []).map((h: any) => (
            <TimelineItem
              key={h.id}
              icon={h.action?.toLowerCase().includes("resolve") ? "✅" : h.action?.toLowerCase().includes("assign") ? "👤" : "🔄"}
              text={`${h.action}${h.performer?.name ? ` by ${h.performer.name}` : ""}`}
              when={h.created_at}
            />
          ))}
          {t.closed_at && (
            <TimelineItem icon="🔒" text="Ticket closed" when={t.closed_at} />
          )}
        </div>
      </div>

      {/* Thread */}
      <div>
        <p className="text-[11px] font-bold tracking-wider text-muted-foreground mb-2">TICKET THREAD</p>
        <div className="rounded-lg border bg-card">
          <TicketChatThread
            ticketId={t.id}
            ticketStatus={t.status}
            raisedBy={t.raised_by}
            assignedTo={t.assigned_to}
          />
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <SignedImage src={lightbox} alt="preview" className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className={cn("text-sm font-medium text-foreground", mono && "font-mono")}>{value}</div>
    </div>
  );
}

function TimelineItem({ icon, text, when }: { icon: string; text: string; when?: string | null }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="mt-0.5">{icon}</span>
      <div className="flex-1">
        <p className="text-foreground">{text}</p>
        {when && <p className="text-[10px] text-muted-foreground">{fmt(when)}</p>}
      </div>
    </div>
  );
}

function AttachmentTile({ url, onPreview }: { url: string; onPreview: (url: string) => void }) {
  const isImg = isImageUrl(url);
  const name = url.split("/").pop()?.split("?")[0] || "file";
  if (isImg) {
    return (
      <div className="relative group aspect-square rounded-md overflow-hidden border bg-muted">
        <SignedImage src={url} alt={name} className="w-full h-full object-cover cursor-pointer" onClick={() => onPreview(url)} />
        <SignedLink href={url} download className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-black/60 text-white p-1 rounded">
          <Download className="h-3 w-3" />
        </SignedLink>
      </div>
    );
  }
  return (
    <SignedLink href={url} className="aspect-square rounded-md border bg-muted/50 flex flex-col items-center justify-center text-xs gap-1 p-2 hover:bg-muted">
      <FileText className="h-6 w-6 text-muted-foreground" />
      <span className="truncate w-full text-center">{name}</span>
    </SignedLink>
  );
}

export function TicketDetailPanel() {
  const [params, setParams] = useSearchParams();
  const ticketKey = params.get("ticket");
  const isMobile = useIsMobile();
  const open = !!ticketKey;

  const close = () => {
    const next = new URLSearchParams(params);
    next.delete("ticket");
    setParams(next, { replace: true });
  };

  const side = isMobile ? "bottom" : "right";

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent
        side={side}
        className={cn(
          "p-0 overflow-hidden flex flex-col",
          isMobile ? "h-[92vh] rounded-t-2xl" : "w-full sm:max-w-[600px] sm:w-[600px]"
        )}
      >
        {isMobile && (
          <div className="flex justify-center pt-2 pb-1">
            <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
          </div>
        )}
        <SheetHeader className="px-5 pt-4 pb-2 border-b">
          <SheetTitle className="text-sm font-semibold text-muted-foreground">Ticket Details</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {ticketKey && <PanelInner ticketKey={ticketKey} onClose={close} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
