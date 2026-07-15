import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Bot, Save, MessagesSquare, Users, Activity, ShieldAlert } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/api/client";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionsContext";
import { formatDate } from "@/utils/dateFormat";

interface AIConfigRow {
  id: string;
  is_enabled: boolean;
  retention_days: number;
}

const RETENTION_OPTIONS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "36500", label: "Forever" },
];

export function AIConfigTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isSuperAdmin } = usePermissions();
  const [enabled, setEnabled] = useState(true);
  const [retention, setRetention] = useState("30");
  const [viewAllOpen, setViewAllOpen] = useState(false);

  const { data: config } = useQuery<AIConfigRow | null>({
    queryKey: ["ai_config"],
    queryFn: async () => {
      const { data } = await supabase.from("ai_config" as any).select("*").maybeSingle();
      return (data ?? null) as any;
    },
  });

  useEffect(() => {
    if (config) {
      setEnabled(config.is_enabled);
      setRetention(String(config.retention_days));
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!config?.id) throw new Error("Config not initialized");
      const { error } = await supabase
        .from("ai_config" as any)
        .update({ is_enabled: enabled, retention_days: Number(retention), updated_at: new Date().toISOString() })
        .eq("id", config.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai_config"] });
      toast({ title: "AI Configuration Saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  // Usage Stats — current month
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const { data: stats } = useQuery({
    queryKey: ["ai_stats", monthStart],
    queryFn: async () => {
      const [{ count: convCount }, { count: msgCount }, { data: convs }] = await Promise.all([
        supabase.from("ai_conversations" as any).select("*", { count: "exact", head: true }).gte("created_at", monthStart),
        supabase.from("ai_messages" as any).select("*", { count: "exact", head: true }).gte("created_at", monthStart),
        supabase.from("ai_conversations" as any).select("user_id").gte("created_at", monthStart),
      ]);
      const counts = new Map<string, number>();
      ((convs as any[]) || []).forEach(c => counts.set(c.user_id, (counts.get(c.user_id) || 0) + 1));
      let topUserId: string | null = null; let topCount = 0;
      counts.forEach((n, uid) => { if (n > topCount) { topCount = n; topUserId = uid; } });
      let topName = "—";
      if (topUserId) {
        const { data: p } = await supabase.from("profiles").select("name").eq("user_id", topUserId).maybeSingle();
        topName = (p as any)?.name || "Unknown";
      }
      return { conversations: convCount || 0, messages: msgCount || 0, topUser: topName };
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Bot className="h-4 w-4 text-primary" /> AI Assistant Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Global enable */}
        <div className="border rounded-lg p-4 flex items-center justify-between">
          <div>
            <Label className="font-medium">Enable AI Assistant for the entire app</Label>
            <p className="text-xs text-muted-foreground mt-1">When disabled, the AI Assistant is hidden for all users regardless of role permissions.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!isSuperAdmin} />
        </div>

        {/* Usage stats */}
        <div className="border rounded-lg p-4 space-y-3">
          <Label className="font-medium flex items-center gap-2"><Activity className="h-4 w-4" /> AI Usage Stats (this month)</Label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-md bg-muted/40 p-3">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><MessagesSquare className="h-3 w-3" /> Total conversations</div>
              <div className="text-2xl font-semibold mt-1">{stats?.conversations ?? "—"}</div>
            </div>
            <div className="rounded-md bg-muted/40 p-3">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><Bot className="h-3 w-3" /> Total messages</div>
              <div className="text-2xl font-semibold mt-1">{stats?.messages ?? "—"}</div>
            </div>
            <div className="rounded-md bg-muted/40 p-3">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> Most active user</div>
              <div className="text-lg font-semibold mt-1 truncate">{stats?.topUser ?? "—"}</div>
            </div>
          </div>
        </div>

        {/* Retention */}
        <div className="border rounded-lg p-4 space-y-2">
          <Label className="font-medium">Keep conversation history for</Label>
          <Select value={retention} onValueChange={setRetention} disabled={!isSuperAdmin}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RETENTION_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Conversations older than this will be automatically deleted.</p>
        </div>

        {/* Super admin: view all conversations */}
        {isSuperAdmin && (
          <div className="border rounded-lg p-4 flex items-center justify-between">
            <div>
              <Label className="font-medium flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-warning" /> Moderation</Label>
              <p className="text-xs text-muted-foreground mt-1">View all user conversations across the app.</p>
            </div>
            <Button variant="outline" onClick={() => setViewAllOpen(true)}>View All Conversations</Button>
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={() => saveMutation.mutate()} disabled={!isSuperAdmin || saveMutation.isPending}>
            <Save className="h-4 w-4 mr-2" /> Save
          </Button>
        </div>
      </CardContent>

      <AllConversationsDialog open={viewAllOpen} onOpenChange={setViewAllOpen} />
    </Card>
  );
}

function AllConversationsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: rows } = useQuery({
    queryKey: ["ai_all_conversations", open],
    enabled: open,
    queryFn: async () => {
      const { data: convs } = await supabase
        .from("ai_conversations" as any)
        .select("id, title, user_id, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      const list = (convs as any[]) || [];
      if (!list.length) return [];
      const userIds = Array.from(new Set(list.map(c => c.user_id)));
      const convIds = list.map(c => c.id);
      const [{ data: profs }, { data: msgs }] = await Promise.all([
        supabase.from("profiles").select("user_id,name").in("user_id", userIds),
        supabase.from("ai_messages" as any).select("conversation_id, role, content, created_at").in("conversation_id", convIds).order("created_at", { ascending: true }),
      ]);
      const nameMap = new Map<string, string>();
      ((profs as any[]) || []).forEach(p => nameMap.set(p.user_id, p.name));
      const msgMap = new Map<string, any[]>();
      ((msgs as any[]) || []).forEach(m => {
        if (!msgMap.has(m.conversation_id)) msgMap.set(m.conversation_id, []);
        msgMap.get(m.conversation_id)!.push(m);
      });
      return list.map(c => ({
        id: c.id,
        title: c.title,
        userName: nameMap.get(c.user_id) || "Unknown",
        date: formatDate(c.created_at, true),
        messages: msgMap.get(c.id) || [],
      }));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>All AI Conversations (Moderation)</DialogTitle>
        </DialogHeader>
        {!rows?.length ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No conversations yet.</p>
        ) : (
          <Accordion type="multiple" className="w-full">
            {rows.map(c => (
              <AccordionItem value={c.id} key={c.id}>
                <AccordionTrigger className="text-sm hover:no-underline">
                  <div className="flex flex-1 items-center justify-between gap-4 text-left pr-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{c.title}</div>
                      <div className="text-xs text-muted-foreground">{c.userName} • {c.date}</div>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{c.messages.length} msg</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2">
                    {c.messages.map((m: any, i: number) => (
                      <div key={i} className={`text-xs p-2 rounded ${m.role === "user" ? "bg-muted/40" : "bg-primary/5"}`}>
                        <div className="font-medium mb-1">{m.role === "user" ? "User" : "Assistant"}</div>
                        <div className="whitespace-pre-wrap">{m.content}</div>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </DialogContent>
    </Dialog>
  );
}
