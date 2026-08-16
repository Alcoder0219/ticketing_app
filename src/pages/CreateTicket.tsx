import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Send } from "lucide-react";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/api/client";
import { useQuery } from "@tanstack/react-query";
import { AttachmentDropzone, AttachmentItem } from "@/components/AttachmentDropzone";
import { VoiceDescriptionInput } from "@/components/VoiceDescriptionInput";

export default function CreateTicket() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [unitId, setUnitId] = useState("");
  const [issueDeptId, setIssueDeptId] = useState("");
  const [priority, setPriority] = useState("low");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [voiceDuration, setVoiceDuration] = useState<number>(0);

  const { data: units } = useQuery({
    queryKey: ["units"],
    queryFn: async () => {
      const { data } = await supabase.from("units").select("*").order("name");
      return data || [];
    },
  });

  // Auto-fill unit from user's profile (user can still change it)
  useEffect(() => {
    if (!unitId && (profile as any)?.unit_id) {
      setUnitId((profile as any).unit_id);
    }
  }, [profile, unitId]);

  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data } = await supabase.from("departments").select("*").eq("is_active", true).order("name");
      return data || [];
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!issueDeptId) {
      toast({ title: t("createTicket.deptRequired"), description: t("createTicket.deptRequiredDesc"), variant: "destructive" });
      return;
    }
    setIsSubmitting(true);

    // 1. Create the ticket first to get its ID
    const { data: created, error: insertError } = await supabase
      .from("tickets")
      .insert({
        title,
        description,
        unit_id: unitId || null,
        department_id: profile?.department_id || null,
        issue_department_id: issueDeptId || null,
        raised_by: user.id,
        priority: priority as any,
        ticket_number: "TEMP",
      })
      .select("id")
      .single();

    if (insertError || !created) {
      setIsSubmitting(false);
      toast({ title: t("messages.error"), description: insertError?.message || t("createTicket.createFailed"), variant: "destructive" });
      return;
    }

    const ticketId = created.id;

    // 2. Upload attachments in parallel, tracking per-file status
    if (attachments.length > 0) {
      const working = [...attachments];
      working.forEach((it, i) => { working[i] = { ...it, status: "uploading" }; });
      setAttachments([...working]);

      const uploadedUrls: string[] = [];
      await Promise.all(
        working.map(async (item, idx) => {
          try {
            const ext = item.file.name.split(".").pop();
            const safeName = item.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
            const path = `${user.id}/${ticketId}/${Date.now()}-${idx}-${safeName}`;
            const { data: uploadData, error: upErr } = await supabase.storage
              .from("ticket-attachments")
              .upload(path, item.file, { contentType: item.file.type });
            if (upErr || !uploadData) throw upErr || new Error("Upload failed");
            const { data: urlData } = supabase.storage
              .from("ticket-attachments")
              .getPublicUrl(uploadData.path);
            uploadedUrls.push(urlData.publicUrl);
            working[idx] = { ...working[idx], status: "success", url: urlData.publicUrl };
          } catch (err: any) {
            working[idx] = { ...working[idx], status: "error", error: err?.message || "Upload failed" };
          }
          setAttachments([...working]);
        })
      );

      // 3. Save URLs onto the ticket (keep first image as photo_url for back-compat)
      const firstImageUrl = working.find(w => w.status === "success" && w.file.type.startsWith("image/"))?.url || null;
      await supabase
        .from("tickets")
        .update({ attachments: uploadedUrls as any, photo_url: firstImageUrl })
        .eq("id", ticketId);
    }

    // Upload voice recording if present
    if (voiceBlob) {
      try {
        const ext = (voiceBlob.type.includes("mp4") ? "m4a" : voiceBlob.type.includes("ogg") ? "ogg" : "webm");
        const path = `${user.id}/${ticketId}/voice-${Date.now()}.${ext}`;
        const { data: up, error: vErr } = await supabase.storage
          .from("ticket-attachments")
          .upload(path, voiceBlob, { contentType: voiceBlob.type || "audio/webm" });
        if (!vErr && up) {
          const { data: urlData } = supabase.storage.from("ticket-attachments").getPublicUrl(up.path);
          await supabase
            .from("tickets")
            .update({
              voice_recording_url: urlData.publicUrl,
              voice_recording_duration: voiceDuration,
            } as any)
            .eq("id", ticketId);
        }
      } catch {
        // Non-blocking — text description and ticket still saved
      }
    }

    setIsSubmitting(false);
    toast({ title: t("createTicket.createdTitle"), description: t("createTicket.createdDesc") });
    navigate("/my-tickets");
  };

  return (
    <AppLayout title={t("nav.createTicket")}>
      <div className="max-w-3xl mx-auto">
        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">{t("createTicket.newSupportTicket")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("createTicket.fillDetails")}</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="rounded-lg bg-muted/50 p-4 space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("createTicket.raisedBy")}</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-2">
                  <div>
                    <p className="text-xs text-muted-foreground">{t("common.name")}</p>
                    <p className="text-sm font-medium">{profile?.name || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("common.employeeId")}</p>
                    <p className="text-sm font-medium">{profile?.employee_id || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("common.contact")}</p>
                    <p className="text-sm font-medium">{profile?.contact || "—"}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("common.unit")}</Label>
                  <Select value={unitId} onValueChange={setUnitId}>
                    <SelectTrigger><SelectValue placeholder={t("createTicket.selectUnit")} /></SelectTrigger>
                    <SelectContent>
                      {units?.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("createTicket.issueDepartment")} *</Label>
                  <Select value={issueDeptId} onValueChange={setIssueDeptId} required>
                    <SelectTrigger><SelectValue placeholder={t("createTicket.selectDepartmentPlaceholder")} /></SelectTrigger>
                    <SelectContent>
                      {departments?.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("common.priority")}</Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">🟢 {t("priority.low")}</SelectItem>
                      <SelectItem value="medium">🟡 {t("priority.medium")}</SelectItem>
                      <SelectItem value="high">🟠 {t("priority.high")}</SelectItem>
                      <SelectItem value="critical">🔴 {t("priority.critical")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("createTicket.ticketTitle")} *</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("createTicket.titlePlaceholder")} required />
              </div>
              <VoiceDescriptionInput
                value={description}
                onChange={setDescription}
                required
                rows={4}
                onAudioRecorded={(blob, dur) => { setVoiceBlob(blob); setVoiceDuration(dur); }}
              />

              <div className="space-y-2">
                <Label>{t("createTicket.attachmentsOptional")}</Label>
                <AttachmentDropzone
                  items={attachments}
                  onChange={setAttachments}
                  disabled={isSubmitting}
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => navigate(-1)}>{t("common.cancel")}</Button>
                <Button type="submit" disabled={isSubmitting}>
                  <Send className="h-4 w-4 mr-2" />
                  {isSubmitting ? t("createTicket.submitting") : t("createTicket.submitTicket")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
