import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Upload, Camera, X, Loader2, AlertCircle, FolderOpen } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/api/client";
import { useToast } from "@/hooks/use-toast";

const ACCEPTED = { "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"], "image/webp": [".webp"] };
const MAX_FILES = 5;
const MAX_SIZE = 10 * 1024 * 1024;

type Photo = { file: File; preview: string };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticketId: string;
  isAdmin?: boolean;
  onResolved: (payload: { photos: string[]; note: string | null }) => Promise<void> | void;
}

export function ResolveTicketModal({ open, onOpenChange, ticketId, isAdmin, onResolved }: Props) {
  const { toast } = useToast();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      photos.forEach((p) => URL.revokeObjectURL(p.preview));
      setPhotos([]);
      setNote("");
      setConfirmed(false);
      setPhotoError(null);
      setConfirmError(null);
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const addFiles = (incoming: File[]) => {
    setPhotoError(null);
    const remaining = MAX_FILES - photos.length;
    const next: Photo[] = [];
    for (const f of incoming.slice(0, remaining)) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) continue;
      if (f.size > MAX_SIZE) continue;
      next.push({ file: f, preview: URL.createObjectURL(f) });
    }
    setPhotos((p) => [...p, ...next]);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: addFiles,
    accept: ACCEPTED,
    maxSize: MAX_SIZE,
    noClick: true,
    disabled: submitting || photos.length >= MAX_FILES,
  });

  const remove = (idx: number) => {
    URL.revokeObjectURL(photos[idx].preview);
    setPhotos((p) => p.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    setPhotoError(null);
    setConfirmError(null);

    if (!isAdmin && photos.length === 0) {
      setPhotoError("⚠️ At least 1 resolution photo is required. Please upload proof that the issue has been resolved.");
      return;
    }
    if (!confirmed) {
      setConfirmError("Please confirm that the issue has been resolved.");
      return;
    }

    setSubmitting(true);
    try {
      const urls: string[] = [];
      for (const p of photos) {
        const ext = p.file.name.split(".").pop() || "jpg";
        const path = `${ticketId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { data, error } = await supabase.storage
          .from("ticket-resolution-photos")
          .upload(path, p.file, { cacheControl: "3600", upsert: false });
        if (error) throw error;
        const { data: url } = supabase.storage.from("ticket-resolution-photos").getPublicUrl(data.path);
        urls.push(url.publicUrl);
      }
      await onResolved({ photos: urls, note: note.trim() || null });
      toast({ title: "Ticket resolved", description: "Ticket resolved successfully with proof of resolution." });
      onOpenChange(false);
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg.includes("RESOLUTION_PHOTO_REQUIRED")) {
        setPhotoError("⚠️ At least 1 resolution photo is required. Please upload proof that the issue has been resolved.");
      } else if (msg.toLowerCase().includes("storage") || msg.toLowerCase().includes("upload")) {
        toast({
          title: "Upload failed",
          description: "Photo upload failed. Please try again. Your ticket has NOT been marked as resolved.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Error", description: msg || "Could not resolve ticket.", variant: "destructive" });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Resolve Ticket</DialogTitle>
          <DialogDescription>Please upload proof of resolution before closing this ticket.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Photos */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              Resolution Photos {!isAdmin && <span className="text-destructive">*</span>}
            </Label>
            <p className="text-xs text-muted-foreground">
              {isAdmin
                ? "Photo upload is required for technicians. As an admin, you may resolve without photos."
                : "Upload at least 1 photo showing the issue has been resolved. Max 5 photos, 10MB each."}
            </p>

            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={submitting || photos.length >= MAX_FILES}
                onClick={() => fileRef.current?.click()}
              >
                <FolderOpen className="h-4 w-4 mr-2" /> 📁 Upload Files
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={submitting || photos.length >= MAX_FILES}
                onClick={() => cameraRef.current?.click()}
              >
                <Camera className="h-4 w-4 mr-2" /> 📷 Take Photo
              </Button>
            </div>

            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(Array.from(e.target.files));
                e.target.value = "";
              }}
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(Array.from(e.target.files));
                e.target.value = "";
              }}
            />

            <div
              {...getRootProps()}
              className={cn(
                "border-2 border-dashed rounded-lg p-4 text-center bg-muted/30 transition-colors",
                isDragActive ? "border-primary bg-primary/5" : "border-border",
                (submitting || photos.length >= MAX_FILES) && "opacity-50"
              )}
            >
              <input {...getInputProps()} />
              <Upload className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
              <p className="text-xs text-muted-foreground">or drag photos here</p>
            </div>

            {photos.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground">
                  {photos.length} of {MAX_FILES} photos added
                </p>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {photos.map((p, i) => (
                    <div key={i} className="relative shrink-0">
                      <img src={p.preview} alt="" className="h-20 w-20 rounded-md border object-cover" />
                      <button
                        type="button"
                        onClick={() => remove(i)}
                        disabled={submitting}
                        className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
                        aria-label="Remove photo"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {photoError && (
              <div className="text-xs text-destructive flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" /> {photoError}
              </div>
            )}
          </div>

          {/* Note */}
          <div className="space-y-2">
            <Label>Resolution Note (Optional)</Label>
            <Textarea
              placeholder="Describe what was done to resolve the issue..."
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              rows={3}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground text-right">{note.length}/500</p>
          </div>

          {/* Confirmation */}
          <div className="space-y-1">
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={confirmed}
                onCheckedChange={(v) => {
                  setConfirmed(!!v);
                  if (v) setConfirmError(null);
                }}
                disabled={submitting}
                className="mt-0.5"
              />
              <span>I confirm that the issue described in this ticket has been fully resolved.</span>
            </label>
            {confirmError && (
              <p className="text-xs text-destructive flex items-center gap-1.5 ml-6">
                <AlertCircle className="h-3.5 w-3.5" /> {confirmError}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Confirm Resolution
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
