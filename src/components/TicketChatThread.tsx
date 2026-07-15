import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Send, Paperclip, X, FileText, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { SignedImage, SignedLink } from "@/components/SignedMedia";
import { formatDistanceToNow } from "date-fns";
import { formatDate } from "@/utils/dateFormat";

interface TicketChatThreadProps {
  ticketId: string;
  ticketStatus: string;
  raisedBy: string;
  assignedTo: string | null;
}

interface ChatMessage {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  message: string | null;
  attachments: any;
  is_system_message: boolean;
  created_at: string;
}

const READ_ONLY_STATUSES = ["resolved", "closed"];
const MAX_FILES = 3;
const MAX_SIZE = 5 * 1024 * 1024;

function roleColor(role: string) {
  const r = role?.toLowerCase();
  if (r === "admin" || r === "super_admin" || r === "hod") return "bg-blue-500 text-white";
  if (r === "assigned_person") return "bg-teal-500 text-white";
  return "bg-muted text-foreground";
}

function roleLabel(role: string) {
  const r = role?.toLowerCase();
  if (r === "super_admin") return "Super Admin";
  if (r === "admin") return "Admin";
  if (r === "hod") return "HOD";
  if (r === "assigned_person") return "Technician";
  return "User";
}

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}

export function TicketChatThread({ ticketId, ticketStatus, raisedBy, assignedTo }: TicketChatThreadProps) {
  const { user, profile, role } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isReadOnly = READ_ONLY_STATUSES.includes(ticketStatus);
  const canWrite = !isReadOnly && (
    user?.id === raisedBy ||
    user?.id === assignedTo ||
    role === "super_admin" ||
    role === "admin" ||
    role === "hod"
  );

  // Initial fetch
  const { data: initial } = useQuery({
    queryKey: ["ticket-messages", ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_messages")
        .select("*")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as ChatMessage[]) || [];
    },
  });

  useEffect(() => {
    if (initial) setMessages(initial);
  }, [initial]);

  // Realtime subscription — handle row events directly; never refetch the full list here.
  useEffect(() => {
    const channel = supabase
      .channel(`ticket-${ticketId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ticket_messages",
          filter: `ticket_id=eq.${ticketId}`,
        },
        (payload) => {
          const newMessage = payload.new as ChatMessage;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMessage.id)) return prev;
            return [...prev, newMessage];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ticket_messages",
          filter: `ticket_id=eq.${ticketId}`,
        },
        (payload) => {
          const updatedMessage = payload.new as ChatMessage;
          setMessages((prev) => prev.map((m) => (m.id === updatedMessage.id ? updatedMessage : m)));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "ticket_messages",
          filter: `ticket_id=eq.${ticketId}`,
        },
        (payload) => {
          const deletedMessage = payload.old as Pick<ChatMessage, "id">;
          setMessages((prev) => prev.filter((m) => m.id !== deletedMessage.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ticketId]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Mark as read
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(`ticket-thread-read-${ticketId}`, new Date().toISOString());
    }
  }, [messages, ticketId]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    const remaining = MAX_FILES - files.length;
    const accepted = selected.slice(0, remaining).filter((f) => {
      if (f.size > MAX_SIZE) {
        toast({ title: "File too large", description: `${f.name} exceeds 5MB`, variant: "destructive" });
        return false;
      }
      return true;
    });
    setFiles((prev) => [...prev, ...accepted]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const handleSend = async () => {
    if (!user || (!input.trim() && files.length === 0) || sending) return;
    setSending(true);
    try {
      // Upload attachments
      const uploaded: { url: string; name: string; type: string }[] = [];
      for (const f of files) {
        const ext = f.name.split(".").pop();
        const path = `${user.id}/chat/${ticketId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { data, error } = await supabase.storage.from("ticket-attachments").upload(path, f);
        if (error) {
          toast({ title: "Upload failed", description: f.name, variant: "destructive" });
          continue;
        }
        const { data: pub } = supabase.storage.from("ticket-attachments").getPublicUrl(data.path);
        uploaded.push({ url: pub.publicUrl, name: f.name, type: f.type });
      }

      const { error: insertError } = await supabase.from("ticket_messages").insert({
        ticket_id: ticketId,
        sender_id: user.id,
        sender_name: profile?.name || "User",
        sender_role: role || "user",
        message: input.trim() || null,
        attachments: uploaded,
        is_system_message: false,
      });
      if (insertError) throw insertError;
      setInput("");
      setFiles([]);
    } catch (err: any) {
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-[600px] bg-background border rounded-lg shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm text-foreground">Ticket Thread</h3>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                isReadOnly ? "bg-muted-foreground/40" : "bg-emerald-500 animate-pulse"
              )}
            />
            {isReadOnly ? "Closed" : "Live"}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">{messages.length} messages</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-muted/10">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
            No messages yet. Start the conversation.
          </div>
        ) : (
          messages.map((m) => {
            if (m.is_system_message) {
              return (
                <div key={m.id} className="flex justify-center my-2">
                  <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full border">
                    {m.message}
                  </span>
                </div>
              );
            }
            const isMine = m.sender_id === user?.id;
            const attachments = Array.isArray(m.attachments) ? m.attachments : [];
            return (
              <div key={m.id} className={cn("flex gap-2 max-w-[85%]", isMine ? "ml-auto flex-row-reverse" : "")}>
                <div
                  className={cn(
                    "h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0",
                    roleColor(m.sender_role)
                  )}
                >
                  {initials(m.sender_name)}
                </div>
                <div className={cn("flex flex-col gap-1", isMine ? "items-end" : "items-start")}>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-foreground">{m.sender_name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {roleLabel(m.sender_role)}
                    </span>
                    <span
                      className="text-muted-foreground"
                      title={formatDate(m.created_at, true)}
                    >
                      {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  {m.message && (
                    <div
                      className={cn(
                        "px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words",
                        isMine ? "bg-primary text-primary-foreground" : "bg-card border"
                      )}
                    >
                      {m.message}
                    </div>
                  )}
                  {attachments.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {attachments.map((a: any, i: number) => {
                        const isImg = a.type?.startsWith("image/") || /\.(jpg|jpeg|png|webp|gif)$/i.test(a.url);
                        return isImg ? (
                          <SignedLink key={i} href={a.url} bucket="ticket-attachments" className="block h-20 w-20 rounded border overflow-hidden">
                            <SignedImage src={a.url} bucket="ticket-attachments" alt={a.name} className="h-full w-full object-cover" />
                          </SignedLink>
                        ) : (
                          <SignedLink key={i} href={a.url} bucket="ticket-attachments" className="flex items-center gap-1.5 px-2 py-1 rounded border bg-card text-xs hover:bg-muted">
                            <FileText className="h-3.5 w-3.5" /> {a.name}
                          </SignedLink>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input or Read-only banner */}
      {isReadOnly ? (
        <div className="border-t p-3 bg-muted/40 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Lock className="h-4 w-4" />
          This ticket is closed. The thread is now read-only.
        </div>
      ) : !canWrite ? (
        <div className="border-t p-3 bg-muted/40 text-center text-sm text-muted-foreground">
          You don't have permission to post in this thread.
        </div>
      ) : (
        <div className="border-t p-3 space-y-2 bg-background">
          {files.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded border bg-muted text-xs">
                  <FileText className="h-3.5 w-3.5" />
                  <span className="max-w-[120px] truncate">{f.name}</span>
                  <button onClick={() => removeFile(i)} className="text-muted-foreground hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
              rows={1}
              className="resize-none min-h-[40px] max-h-[80px]"
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf"
              className="hidden"
              onChange={handleFileSelect}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={files.length >= MAX_FILES}
              title="Attach file"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              onClick={handleSend}
              disabled={sending || (!input.trim() && files.length === 0)}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
