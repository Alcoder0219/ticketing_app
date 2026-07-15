import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Bot, Plus, Search, Send, Trash2, Download, MessageSquare, Loader2, Ticket as TicketIcon, Paperclip, X, FileText, Mic, MicOff, Languages } from "lucide-react";
import { supabase } from "@/integrations/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/contexts/PermissionsContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/dateFormat";
import { ExtractedPriority } from "@/utils/extractTicket";
import { LANGUAGES, LangCode, loadLang, saveLang, isRtl, voiceLocale, scriptHint, welcomeText, langOption } from "@/lib/aiLang";

interface Conversation { id: string; title: string; updated_at: string }
interface ChipOption { label: string; value: string }
interface ConfirmCardData {
  title: string;
  description: string;
  departmentId: string | null;
  departmentName: string | null;
  priority: ExtractedPriority;
  raisedByName: string;
  unitName: string;
  resolved?: boolean;
  // Multilingual intake (optional): stored on the ticket for traceability.
  originalLanguage?: string;
  originalMessage?: string;
  translatedMessage?: string;
}
interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  chips?: ChipOption[];
  chipKind?: "view-tickets";
  chipsDisabled?: boolean;
  confirmCard?: ConfirmCardData;
  /** Detected/selected language of this message — drives RTL rendering. */
  lang?: string;
}

interface TicketContext {
  ticket_number?: string; title?: string; status?: string; priority?: string;
  assigned_to?: string; sla_due_at?: string;
}

const ASSISTANT_NAME = "Ticketing Assistant";

const PRIORITY_OPTIONS: { value: ExtractedPriority; label: string }[] = [
  { value: "critical", label: "🔴 Critical" },
  { value: "high", label: "🟠 High" },
  { value: "medium", label: "🟡 Medium" },
  { value: "low", label: "🟢 Low" },
];

const QUICK_PROMPTS = [
  "📊 How many tickets are pending?",
  "⏰ Explain SLA policies",
  "🎫 Help me write a ticket description",
  "📈 What are common ticket issues?",
];

function welcomeMessage(firstName: string, lang: LangCode = "en"): Message {
  return {
    role: "assistant",
    content: welcomeText(firstName, lang),
    created_at: new Date().toISOString(),
    lang,
  };
}

/** Localized intro shown above the ticket confirmation card. */
function cardIntro(lang: string, hasDept: boolean): string {
  if (lang === "sw") {
    return hasDept
      ? "Haya ndiyo niliyoyapata kutoka kwa ujumbe wako. Kagua na uthibitishe ili kuwasilisha:"
      : "Sikuweza kubaini idara. Tafadhali chagua idara, kisha uthibitishe ili kuwasilisha:";
  }
  if (lang === "ar") {
    return hasDept
      ? "هذا ما فهمته من رسالتك. راجع البيانات وأكِّد للإرسال:"
      : "لم أتمكن من تحديد القسم. الرجاء اختيار القسم ثم التأكيد للإرسال:";
  }
  return hasDept
    ? "Here's what I picked up from your message. Review and confirm to submit:"
    : "I couldn't tell which department this belongs to. Please pick one, then confirm to submit:";
}

export default function AIAssistant() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, role } = useAuth();
  const { permissions, isSuperAdmin, loading: permsLoading } = usePermissions();
  const queryClient = useQueryClient();
  const firstName = (profile?.name || "there").split(" ")[0];

  // Global AI Assistant on/off + per-role permission guard
  const { data: aiConfig } = useQuery({
    queryKey: ["ai_config"],
    queryFn: async () => {
      const { data } = await supabase.from("ai_config" as any).select("is_enabled").maybeSingle();
      return data as any;
    },
  });

  useEffect(() => {
    if (permsLoading) return;
    const globallyDisabled = aiConfig && aiConfig.is_enabled === false && !isSuperAdmin;
    const noPermission = !isSuperAdmin && !permissions?.sidebar?.aiAssistant;
    if (globallyDisabled || noPermission) {
      toast.error("You do not have permission to access the AI Assistant.");
      navigate("/", { replace: true });
    }
  }, [permsLoading, permissions, isSuperAdmin, aiConfig, navigate]);

  const [search, setSearch] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [lang, setLang] = useState<LangCode>(loadLang);
  const [isListening, setIsListening] = useState(false);
  const langRef = useRef<LangCode>(lang);
  useEffect(() => { langRef.current = lang; saveLang(lang); }, [lang]);
  const inputRtl = isRtl(lang);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prefilledRef = useRef(false);

  // Initialize SpeechRecognition (Web Speech API)
  useEffect(() => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setVoiceSupported(false); return; }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    let finalText = "";
    rec.onstart = () => { finalText = input ? input + " " : ""; };
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t + " ";
        else interim += t;
      }
      setInput((finalText + interim).slice(0, 2000));
    };
    rec.onerror = (e: any) => {
      setIsListening(false);
      if (e.error === "not-allowed") toast.error("Microphone permission denied");
      else if (e.error !== "no-speech" && e.error !== "aborted") toast.error("Voice input error");
    };
    rec.onend = () => setIsListening(false);
    recognitionRef.current = rec;
    return () => { try { rec.stop(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleVoice = () => {
    if (!voiceSupported) { toast.error("Voice input is not supported in this browser"); return; }
    const rec = recognitionRef.current;
    if (!rec) return;
    if (isListening) {
      try { rec.stop(); } catch {}
      setIsListening(false);
    } else {
      try {
        // Transcribe in the currently selected language (English/Swahili/Arabic).
        rec.lang = voiceLocale(langRef.current);
        rec.start();
        setIsListening(true);
        const opt = langOption(langRef.current);
        toast.info(`Listening (${opt.flag} ${opt.label})… speak your ticket or question`);
      } catch {
        setIsListening(false);
      }
    }
  };


  // Fetch active departments for the chips
  const { data: activeDepartments = [] } = useQuery({
    queryKey: ["active-departments-chat"],
    queryFn: async () => {
      const { data } = await supabase
        .from("departments")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      return (data || []) as { id: string; name: string }[];
    },
  });


  // Resolve unit + department names for context
  const { data: unitName } = useQuery({
    queryKey: ["unit-name", profile?.unit_id],
    enabled: !!profile?.unit_id,
    queryFn: async () => {
      const { data } = await supabase.from("units").select("name").eq("id", profile!.unit_id!).maybeSingle();
      return (data as any)?.name as string | undefined;
    },
  });
  const { data: deptName } = useQuery({
    queryKey: ["dept-name", profile?.department_id],
    enabled: !!profile?.department_id,
    queryFn: async () => {
      const { data } = await supabase.from("departments").select("name").eq("id", profile!.department_id!).maybeSingle();
      return (data as any)?.name as string | undefined;
    },
  });

  const { data: conversations = [] } = useQuery({
    queryKey: ["ai_conversations", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_conversations" as any)
        .select("id, title, updated_at")
        .eq("user_id", user!.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as Conversation[];
    },
    enabled: !!user,
  });

  // Load messages for active conversation
  useEffect(() => {
    if (!conversationId) {
      setMessages([welcomeMessage(firstName, lang)]);
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from("ai_messages" as any)
        .select("id, role, content, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (error) { toast.error("Failed to load conversation"); return; }
      const rows = ((data || []) as unknown) as Message[];
      setMessages(rows.length ? rows : [welcomeMessage(firstName, lang)]);
    })();
  }, [conversationId, firstName]);

  // Autoscroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  // Focus input
  useEffect(() => { inputRef.current?.focus(); }, [conversationId, streaming]);

  // Handle pre-filled ticket context from navigation state (one-shot)
  const navState = location.state as { prefillMessage?: string; ticketContext?: TicketContext } | null;
  useEffect(() => {
    if (prefilledRef.current) return;
    if (!navState?.prefillMessage || !user || conversationId) return;
    prefilledRef.current = true;
    window.history.replaceState({}, "");
    sendMessage(navState.prefillMessage, navState.ticketContext);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, conversationId, navState]);

  const filtered = conversations.filter(c =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  const activeTitle = conversationId
    ? conversations.find(c => c.id === conversationId)?.title || "Conversation"
    : "New Conversation";

  const handleNewChat = () => {
    setMessages([welcomeMessage(firstName, lang)]);
    setInput("");
    navigate("/ai-assistant");
  };

  const pushAssistant = (msg: Omit<Message, "role" | "created_at">) => {
    setMessages(prev => [
      ...prev,
      { role: "assistant", created_at: new Date().toISOString(), id: "flow-" + Date.now() + "-" + Math.random(), ...msg },
    ]);
  };

  const pushUser = (content: string, msgLang?: string) => {
    setMessages(prev => [
      ...prev,
      { role: "user", content, created_at: new Date().toISOString(), id: "flow-u-" + Date.now(), lang: msgLang },
    ]);
  };

  // Mark a confirm-card message as resolved (read-only) once submitted/cancelled.
  const resolveCard = (cardMsgId: string) => {
    setMessages(prev => prev.map(m =>
      m.id === cardMsgId && m.confirmCard ? { ...m, confirmCard: { ...m.confirmCard, resolved: true } } : m
    ));
  };

  // Called by ConfirmCard on submit
  const handleCardSubmit = async (
    cardMsgId: string,
    card: ConfirmCardData,
    files: File[],
    onProgress: (current: number, total: number) => void,
  ) => {
    if (!user) return;
    if (!card.title.trim()) { toast.error("Title is required"); return; }
    if (!card.departmentId) { toast.error("Please select a department"); return; }

    const { data, error } = await supabase
      .from("tickets")
      .insert({
        title: card.title.trim(),
        description: (card.description || card.title).trim(),
        issue_department_id: card.departmentId,
        priority: card.priority,
        raised_by: user.id,
        unit_id: profile?.unit_id ?? null,
        status: "open",
        // Multilingual intake metadata (optional; null for non-AI tickets).
        original_language: card.originalLanguage ?? null,
        original_message: card.originalMessage ?? null,
        translated_message: card.translatedMessage ?? null,
      } as any)
      .select("id, ticket_number, created_at")
      .single();

    if (error || !data) {
      resolveCard(cardMsgId);
      pushAssistant({ content: "❌ Could not create ticket. Please try again or use the Create Ticket page." });
      return;
    }
    const ticketId = (data as any).id as string;
    const tn = (data as any).ticket_number as string;
    const created = (data as any).created_at as string;

    // Upload attachments (if any)
    const failedFiles: string[] = [];
    let successCount = 0;
    if (files.length > 0) {
      onProgress(0, files.length);
      const uploadedUrls: string[] = [];
      let done = 0;
      await Promise.all(
        files.map(async (file, idx) => {
          try {
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
            const path = `${user.id}/${ticketId}/${Date.now()}-${idx}-${safeName}`;
            const { data: up, error: upErr } = await supabase.storage
              .from("ticket-attachments")
              .upload(path, file, { contentType: file.type });
            if (upErr || !up) throw upErr || new Error("Upload failed");
            const { data: urlData } = supabase.storage.from("ticket-attachments").getPublicUrl(up.path);
            uploadedUrls.push(urlData.publicUrl);
            successCount++;
          } catch {
            failedFiles.push(file.name);
          } finally {
            done++;
            onProgress(done, files.length);
          }
        }),
      );
      if (uploadedUrls.length > 0) {
        const firstImageUrl = uploadedUrls.find((u) => /\.(jpe?g|png|webp|gif)$/i.test(u)) || null;
        await supabase
          .from("tickets")
          .update({ attachments: uploadedUrls as any, photo_url: firstImageUrl } as any)
          .eq("id", ticketId);
      }
    }

    resolveCard(cardMsgId);

    let content =
`✅ **Your ticket has been raised successfully!**

🎫 **Ticket ID:** ${tn}
📋 ${card.title}
🏢 ${card.departmentName} | ⚡ ${card.priority.charAt(0).toUpperCase() + card.priority.slice(1)}
📅 Created: ${formatDate(created, true)}`;

    if (files.length > 0) {
      content += `\n📎 ${successCount} attachment(s) uploaded`;
    }
    if (failedFiles.length > 0) {
      content += failedFiles
        .map((n) => `\n⚠️ Ticket created but ${n} could not be uploaded. You can add it from the ticket detail page.`)
        .join("");
    }
    content += `\n\nYour ticket is now **Pending** and will be assigned to a technician shortly.`;

    pushAssistant({
      content,
      chips: [{ label: "📋 View in My Tickets", value: "view" }],
      chipKind: "view-tickets",
    });
  };

  const handleCardCancel = (cardMsgId: string) => {
    resolveCard(cardMsgId);
    pushAssistant({ content: "Ticket cancelled. Let me know if you need anything else!" });
  };

  const handleChipClick = (kind: Message["chipKind"]) => {
    if (kind === "view-tickets") navigate("/my-tickets");
  };

  const sendMessage = async (text: string, ticketContext?: TicketContext) => {
    const content = text.trim();
    if (!content || streaming || !user) return;
    if (content.length > 2000) { toast.error("Message too long (2000 char max)"); return; }

    setInput("");

    // Immediate RTL hint for the user's own bubble (Arabic script only).
    const userLangHint = scriptHint(content) || lang;

    setStreaming(true);

    // 1) Multilingual classify + extract. Any failure falls back to chat.
    let cls: any = null;
    try {
      const { data } = await supabase.functions.invoke("ai-classify-extract", {
        body: { message: content, selected_language: lang },
      });
      cls = data;
    } catch {
      cls = null;
    }
    const detectedLang = (cls?.language as string) || userLangHint;

    // 2) Ticket intent → show an editable confirmation card (kept ephemeral,
    //    matching the previous single-prompt flow — not persisted to a conversation).
    if (cls?.intent === "ticket") {
      setStreaming(false);
      pushUser(content, userLangHint);
      pushAssistant({
        lang: detectedLang,
        content: cardIntro(detectedLang, !!cls.departmentId),
        confirmCard: {
          title: cls.title || content,
          description: cls.description || cls.title || content,
          departmentId: cls.departmentId ?? null,
          departmentName: cls.departmentName ?? null,
          priority: (cls.priority as ExtractedPriority) || "medium",
          raisedByName: profile?.name || "—",
          unitName: unitName || "—",
          originalLanguage: detectedLang,
          originalMessage: cls.originalMessage || content,
          translatedMessage: cls.translatedMessage || content,
        },
      });
      return;
    }

    let convId = conversationId;

    if (!convId) {
      const title = content.slice(0, 50);
      const { data, error } = await supabase
        .from("ai_conversations" as any)
        .insert({ user_id: user.id, title })
        .select("id")
        .single();
      if (error || !data) { toast.error("Failed to create conversation"); setStreaming(false); return; }
      convId = (data as any).id;
      queryClient.invalidateQueries({ queryKey: ["ai_conversations"] });
    }

    const userMsg: Message = { role: "user", content, created_at: new Date().toISOString(), lang: userLangHint };
    const display = messages.length === 1 && !messages[0].id ? [userMsg] : [...messages, userMsg];
    setMessages(display);

    await supabase.from("ai_messages" as any).insert({
      conversation_id: convId, role: "user", content,
    });

    const history = display
      .filter(m => m.id || m.role === "user")
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const { data, error } = await supabase.functions.invoke("chat-with-ai", {
        body: {
          messages: history,
          user_context: {
            name: profile?.name,
            role: role,
            unit: unitName,
            department: deptName,
          },
          ticket_context: ticketContext,
          selected_language: lang,
        },
      });

      const reply = (data as any)?.reply as string | undefined;
      const errMsg = (data as any)?.error as string | undefined;

      if (error || !reply) {
        toast.error(errMsg || error?.message || "AI request failed");
        setStreaming(false);
        return;
      }

      await supabase.from("ai_messages" as any).insert({
        conversation_id: convId, role: "assistant", content: reply,
      });
      await supabase.from("ai_conversations" as any).update({ updated_at: new Date().toISOString() }).eq("id", convId);

      setMessages(prev => [...prev, { role: "assistant", content: reply, created_at: new Date().toISOString(), id: "tmp-" + Date.now(), lang: detectedLang }]);
      setStreaming(false);

      if (!conversationId) navigate(`/ai-assistant/${convId}`, { replace: true });
      queryClient.invalidateQueries({ queryKey: ["ai_conversations"] });
    } catch (e) {
      toast.error("Failed to get AI response");
      setStreaming(false);
    }
  };

  const handleSend = () => sendMessage(input);
  const handleQuickPrompt = (text: string) => sendMessage(text);


  const handleClearChat = async () => {
    if (!conversationId) { setMessages([welcomeMessage(firstName, lang)]); return; }
    const { error } = await supabase.from("ai_conversations" as any).delete().eq("id", conversationId);
    if (error) { toast.error("Failed to clear chat"); return; }
    toast.success("Conversation deleted");
    queryClient.invalidateQueries({ queryKey: ["ai_conversations"] });
    navigate("/ai-assistant");
  };

  const handleExport = () => {
    const lines = messages.map(m => {
      const ts = m.created_at ? formatDate(m.created_at, true) : "";
      const who = m.role === "user" ? (profile?.name || "You") : ASSISTANT_NAME;
      return `[${ts}] ${who}:\n${m.content}\n`;
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeTitle.replace(/[^a-z0-9]+/gi, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const userInitials = (profile?.name || "U").split(" ").map(p => p[0]).slice(0, 2).join("");
  const showQuickPrompts = !conversationId && messages.length === 1 && !messages[0].id && !streaming;

  return (
    <AppLayout title="AI Assistant">
      <div className="flex gap-6 h-[calc(100vh-8rem)]">
        {/* LEFT: Conversation list */}
        <aside className="w-[30%] min-w-[280px] flex flex-col rounded-xl border border-border/70 bg-card shadow-sm overflow-hidden">
          <div className="px-4 py-3.5 border-b border-border/70 flex items-center justify-between gap-2">
            <h2 className="font-semibold text-[15px] tracking-tight">Conversations</h2>
            <Button size="sm" onClick={handleNewChat} className="h-8 rounded-lg shadow-sm transition-all duration-200 hover:shadow active:scale-95">
              <Plus className="h-4 w-4 mr-1" /> New Chat
            </Button>
          </div>
          <div className="px-4 py-3 border-b border-border/70">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search conversations..."
                className="h-9 pl-9 text-sm rounded-lg bg-muted/40 border-transparent focus-visible:bg-card focus-visible:border-border transition-colors"
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            {filtered.length === 0 ? (
              <div className="p-8 flex flex-col items-center text-center gap-3 text-muted-foreground">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                  <MessageSquare className="h-6 w-6 opacity-60" />
                </div>
                <p className="text-sm font-medium text-foreground/70">No conversations yet</p>
                <p className="text-xs">Start a new chat to see it here.</p>
              </div>
            ) : (
              <ul className="p-2 space-y-1">
                {filtered.map(c => (
                  <li key={c.id}>
                    <button
                      onClick={() => navigate(`/ai-assistant/${c.id}`)}
                      className={cn(
                        "w-full text-left rounded-lg px-3 py-2.5 transition-all duration-200 hover:bg-muted/60",
                        conversationId === c.id
                          ? "bg-primary/10 ring-1 ring-primary/30"
                          : ""
                      )}
                    >
                      <p className={cn(
                        "text-sm font-medium truncate",
                        conversationId === c.id ? "text-primary" : "text-foreground"
                      )}>{c.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {formatDate(c.updated_at, true)}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </aside>

        {/* RIGHT: Active chat */}
        <section className="flex-1 flex flex-col rounded-xl border border-border/70 bg-card shadow-sm overflow-hidden min-w-0">
          <div className="px-5 py-3.5 border-b border-border/70 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                <MessageSquare className="h-4 w-4 text-primary" />
              </div>
              <h3 className="font-semibold text-[15px] tracking-tight truncate">{activeTitle}</h3>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleExport} disabled={messages.length === 0} className="rounded-lg transition-all duration-200 active:scale-95">
                <Download className="h-3.5 w-3.5 mr-1" /> Export
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="rounded-lg text-destructive hover:text-destructive hover:bg-destructive/5 transition-all duration-200 active:scale-95">
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear Chat
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear this conversation?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete this conversation and all its messages.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleClearChat}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-slim p-6 space-y-6">
            {showQuickPrompts ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-4 animate-message-in">
                {/* Premium hero card */}
                <div className="relative w-full max-w-lg rounded-2xl border border-border/70 bg-gradient-to-b from-primary/5 to-card p-8 shadow-sm overflow-hidden">
                  <div className="absolute -top-16 -right-16 h-40 w-40 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
                  <div className="relative flex flex-col items-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-blue-500 text-primary-foreground shadow-lg shadow-primary/30">
                      <Bot className="h-8 w-8" />
                    </div>
                    <p className="mt-4 text-sm font-medium text-muted-foreground">Hi {firstName} 👋</p>
                    <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground">AI Ticketing Assistant</h2>
                    <p className="mt-2 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                      I can help you manage tickets, explain policies, generate reports, answer HR queries and assist with support workflows.
                    </p>
                  </div>
                </div>
                {/* Suggestion chips */}
                <div className="mt-6 w-full max-w-lg">
                  <p className="text-xs font-medium text-muted-foreground mb-3">Try one of these</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {QUICK_PROMPTS.map(p => (
                      <button
                        key={p}
                        onClick={() => handleQuickPrompt(p)}
                        className="group flex items-center gap-2 rounded-xl border border-border/70 bg-card px-4 py-3 text-sm text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md active:translate-y-0"
                      >
                        <span className="truncate">{p}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <>
                {messages.map((m, i) => (
                  <MessageBubble
                    key={m.id || i}
                    msg={m}
                    userInitials={userInitials}
                    onChipClick={handleChipClick}
                    departments={activeDepartments}
                    onCardSubmit={handleCardSubmit}
                    onCardCancel={handleCardCancel}
                  />
                ))}
                {streaming && (
                  <MessageBubble
                    msg={{ role: "assistant", content: "", created_at: new Date().toISOString() }}
                    userInitials={userInitials}
                    isStreaming
                  />
                )}
              </>
            )}
          </div>

          <div className="border-t border-border/70 p-4 space-y-2.5">
            {/* Language selector + auto-detect indicator */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Languages className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Select value={lang} onValueChange={(v) => setLang(v as LangCode)}>
                  <SelectTrigger className="h-8 w-[168px] text-xs rounded-lg" aria-label="Assistant language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.code} value={l.code} className="text-xs">
                        <span className="mr-1.5">{l.flag}</span>{l.label} · {l.native}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <span className="text-[10px] text-muted-foreground/70 hidden sm:inline">
                Auto-detects 🇺🇸 English · 🇹🇿 Swahili · 🇸🇦 Arabic
              </span>
            </div>
            <div className="flex items-end gap-1.5 rounded-2xl border border-border/70 bg-background px-2 py-1.5 shadow-sm transition-all duration-200 focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10">
              <Textarea
                ref={inputRef}
                value={input}
                dir={inputRtl ? "rtl" : "ltr"}
                onChange={(e) => setInput(e.target.value.slice(0, 2000))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  isListening
                    ? "🎙️ Listening… speak now"
                    : streaming
                      ? "AI is thinking..."
                      : "Ask me anything, or click 🎙️ to raise a ticket by voice..."
                }
                disabled={streaming}
                rows={1}
                className={cn(
                  "resize-none min-h-[40px] max-h-[120px] flex-1 border-0 bg-transparent px-2 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
                  inputRtl && "text-right",
                )}
              />
              <Button
                type="button"
                onClick={toggleVoice}
                disabled={streaming || !voiceSupported}
                size="icon"
                variant={isListening ? "destructive" : "ghost"}
                className="h-9 w-9 shrink-0 rounded-xl transition-all duration-200 active:scale-90"
                title={
                  !voiceSupported
                    ? "Voice input not supported in this browser"
                    : isListening
                      ? "Stop recording"
                      : "Start voice input"
                }
                aria-label={isListening ? "Stop voice input" : "Start voice input"}
              >
                {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
              <Button
                onClick={handleSend}
                disabled={!input.trim() || streaming}
                size="icon"
                className="h-9 w-9 shrink-0 rounded-xl shadow-sm transition-all duration-200 hover:shadow active:scale-90"
              >
                {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>

            <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
              <span className="hidden sm:flex items-center gap-1.5">
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[10px] font-medium">Enter</kbd>
                to send
                <span className="text-muted-foreground/50">·</span>
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[10px] font-medium">Shift + Enter</kbd>
                new line
              </span>
              {input.length > 1500 && (
                <span className={cn(input.length > 1900 && "text-destructive")}>{input.length}/2000</span>
              )}
            </div>
            <p className="text-center text-[10px] text-muted-foreground/70">
              AI responses are generated and may not always be accurate. Verify important information.
            </p>
          </div>
        </section>
      </div>
    </AppLayout>
  );
}

function MessageBubble({
  msg,
  userInitials,
  isStreaming,
  onChipClick,
  departments,
  onCardSubmit,
  onCardCancel,
}: {
  msg: Message;
  userInitials: string;
  isStreaming?: boolean;
  onChipClick?: (kind: Message["chipKind"]) => void;
  departments?: { id: string; name: string }[];
  onCardSubmit?: (cardMsgId: string, card: ConfirmCardData, files: File[], onProgress: (current: number, total: number) => void) => void;
  onCardCancel?: (cardMsgId: string) => void;
}) {
  const isUser = msg.role === "user";
  const ts = msg.created_at ? formatDate(msg.created_at, true) : "";
  const rtl = isRtl(msg.lang);

  if (isUser) {
    return (
      <div className="flex items-start gap-2.5 justify-end animate-message-in">
        <div className="flex flex-col items-end max-w-[78%]">
          <div
            dir={rtl ? "rtl" : undefined}
            className={cn(
              "bg-primary text-primary-foreground rounded-2xl rounded-tr-md px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap shadow-sm shadow-primary/20",
              rtl && "text-right",
            )}
          >
            {msg.content}
          </div>
          <span className="text-[10px] text-muted-foreground mt-1.5 mr-1">{ts}</span>
        </div>
        <Avatar className="h-8 w-8 shrink-0 ring-2 ring-primary/20">
          <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">{userInitials}</AvatarFallback>
        </Avatar>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5 animate-message-in">
      <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-blue-500 text-white flex items-center justify-center shrink-0 shadow-sm shadow-primary/30">
        <Bot className="h-4 w-4" />
      </div>
      <div className="flex flex-col max-w-[85%]">
        <span className="text-[11px] font-semibold text-foreground/70 mb-1 ml-0.5">{ASSISTANT_NAME}</span>
        <div className="bg-card border border-border/70 rounded-2xl rounded-tl-md px-4 py-3 text-[15px] leading-relaxed shadow-sm">
          {isStreaming ? (
            <div className="flex items-center gap-1 py-1">
              <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          ) : (
            <div
              dir={rtl ? "rtl" : undefined}
              className={cn(
                "prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-pre:my-2",
                rtl && "text-right",
              )}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
            </div>
          )}
          {msg.confirmCard && (
            <ConfirmCard
              card={msg.confirmCard}
              departments={departments || []}
              onSubmit={(data, files, onProgress) => onCardSubmit?.(msg.id!, data, files, onProgress)}
              onCancel={() => onCardCancel?.(msg.id!)}
            />
          )}
          {msg.chips && msg.chips.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {msg.chips.map((c, idx) => (
                <button
                  key={`${c.value}-${idx}`}
                  disabled={msg.chipsDisabled || !c.value}
                  onClick={() => onChipClick?.(msg.chipKind)}
                  className={cn(
                    "px-3.5 py-1.5 text-xs font-medium rounded-full border border-border/70 bg-background shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary hover:text-primary-foreground hover:border-primary hover:shadow-md active:translate-y-0",
                    msg.chipsDisabled && "opacity-50 cursor-not-allowed hover:bg-background hover:text-foreground hover:translate-y-0 hover:shadow-sm",
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground mt-1.5 ml-1">{ts}</span>
      </div>
    </div>
  );
}

const MAX_FILES = 5;
const MAX_SIZE = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"];
const ACCEPTED_ATTR = ".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf";

function ConfirmCard({
  card,
  departments,
  onSubmit,
  onCancel,
}: {
  card: ConfirmCardData;
  departments: { id: string; name: string }[];
  onSubmit: (data: ConfirmCardData, files: File[], onProgress: (current: number, total: number) => void) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [departmentId, setDepartmentId] = useState<string | null>(card.departmentId);
  const [priority, setPriority] = useState<ExtractedPriority>(card.priority);
  const [submitting, setSubmitting] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const readOnly = !!card.resolved;
  const deptMissing = !departmentId;
  const canSubmit = !readOnly && !submitting && title.trim().length > 0 && !!departmentId;

  // Build object URLs for image previews
  useEffect(() => {
    const next: Record<string, string> = {};
    files.forEach((f) => {
      if (f.type.startsWith("image/")) {
        next[f.name + f.size] = URL.createObjectURL(f);
      }
    });
    setPreviews(next);
    return () => {
      Object.values(next).forEach((u) => URL.revokeObjectURL(u));
    };
  }, [files]);

  const addFiles = (incoming: File[]) => {
    setFileError(null);
    const next = [...files];
    for (const f of incoming) {
      if (!ACCEPTED_TYPES.includes(f.type)) {
        setFileError(`${f.name} — unsupported file type`);
        continue;
      }
      if (f.size > MAX_SIZE) {
        setFileError("File too large — max 5MB");
        continue;
      }
      if (next.length >= MAX_FILES) {
        setFileError("Maximum 5 files allowed");
        break;
      }
      if (next.some((n) => n.name === f.name && n.size === f.size)) continue;
      next.push(f);
    }
    setFiles(next);
  };

  const removeFile = (idx: number) => {
    setFiles(files.filter((_, i) => i !== idx));
    setFileError(null);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setProgress(files.length > 0 ? { current: 0, total: files.length } : null);
    const dept = departments.find((d) => d.id === departmentId);
    await onSubmit(
      {
        ...card,
        title: title.trim(),
        description: description.trim() || title.trim(),
        departmentId,
        departmentName: dept?.name || card.departmentName,
        priority,
      },
      files,
      (current, total) => setProgress({ current, total }),
    );
  };

  return (
    <div className="mt-3 rounded-lg border bg-muted/30 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/60">
        <TicketIcon className="h-4 w-4 text-primary" />
        <span className="font-semibold text-sm">
          {readOnly ? "Ticket — Submitted" : "New Ticket — Ready to Submit"}
        </span>
      </div>
      <div className="p-3 space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Title</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={readOnly}
            className="h-9 mt-1"
            placeholder="Short summary"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Description</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={readOnly}
            rows={2}
            className="mt-1"
            placeholder="Details about the issue"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Department</label>
            <Select
              value={departmentId ?? undefined}
              onValueChange={(v) => setDepartmentId(v)}
              disabled={readOnly}
            >
              <SelectTrigger
                className={cn(
                  "h-9 mt-1",
                  !readOnly && deptMissing && "border-destructive ring-1 ring-destructive/40",
                )}
              >
                <SelectValue placeholder="Select Department" />
              </SelectTrigger>
              <SelectContent>
                {departments.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!readOnly && deptMissing && (
              <p className="text-[11px] text-destructive mt-1">Please select a department to continue</p>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Priority</label>
            <Select
              value={priority}
              onValueChange={(v) => setPriority(v as ExtractedPriority)}
              disabled={readOnly}
            >
              <SelectTrigger className="h-9 mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map(p => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Raised By</p>
            <p className="text-sm">{card.raisedByName}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Unit</p>
            <p className="text-sm">{card.unitName}</p>
          </div>
        </div>

        {!readOnly && (
          <div className="pt-1">
            <p className="text-xs font-medium">📎 Attachments (Optional)</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Add screenshots or files to help describe the issue.
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (submitting) return;
                addFiles(Array.from(e.dataTransfer.files));
              }}
              disabled={submitting}
              className={cn(
                "mt-2 w-full rounded-md border-2 border-dashed px-3 py-4 flex flex-col items-center justify-center gap-1 text-center transition-colors",
                dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/60",
                submitting && "opacity-60 cursor-not-allowed",
              )}
            >
              <Paperclip className="h-5 w-5 text-muted-foreground" />
              <span className="text-xs font-medium">Click to upload or drag and drop</span>
              <span className="text-[10px] text-muted-foreground">
                JPG, PNG, WEBP, PDF · Max 5 files · 5MB each
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_ATTR}
              className="hidden"
              onChange={(e) => {
                addFiles(Array.from(e.target.files || []));
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
            {fileError && (
              <p className="text-[11px] text-destructive mt-1">{fileError}</p>
            )}
            {files.length > 0 && (
              <>
                <p className="text-[11px] text-muted-foreground mt-2">{files.length} file{files.length !== 1 ? "s" : ""} selected</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {files.map((f, idx) => {
                    const isImage = f.type.startsWith("image/");
                    const key = f.name + f.size;
                    return (
                      <div key={key + idx} className="relative w-20 h-20 rounded-md border bg-background overflow-hidden flex items-center justify-center">
                        {isImage && previews[key] ? (
                          <img src={previews[key]} alt={f.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="flex flex-col items-center justify-center px-1 text-center">
                            <FileText className="h-6 w-6 text-muted-foreground" />
                            <span className="text-[9px] truncate w-full mt-0.5">{f.name}</span>
                          </div>
                        )}
                        {!submitting && (
                          <button
                            type="button"
                            onClick={() => removeFile(idx)}
                            className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center hover:opacity-90"
                            aria-label="Remove file"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {submitting && progress && progress.total > 0 && (
              <p className="text-[11px] text-muted-foreground mt-2">
                Uploading attachments ({progress.current} of {progress.total})...
              </p>
            )}
          </div>
        )}
      </div>
      {!readOnly && (
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t bg-muted/40">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={submitting}>
            ❌ Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
            {submitting && progress && progress.total > 0
              ? `Uploading... ${progress.current}/${progress.total} files`
              : "✅ Confirm & Submit"}
          </Button>
        </div>
      )}
    </div>
  );
}
