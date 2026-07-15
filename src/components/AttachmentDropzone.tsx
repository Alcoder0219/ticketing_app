import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, X, FileText, Loader2, AlertCircle, Paperclip, Camera, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type AttachmentItem = {
  file: File;
  preview: string;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
  url?: string;
  progress?: number;
};

interface Props {
  items: AttachmentItem[];
  onChange: (items: AttachmentItem[]) => void;
  maxFiles?: number;
  maxSize?: number;
  disabled?: boolean;
}

const ACCEPTED = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "application/pdf": [".pdf"],
};
const ACCEPTED_TYPES = Object.keys(ACCEPTED);

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isMobile() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function AttachmentDropzone({
  items,
  onChange,
  maxFiles = 5,
  maxSize = 5 * 1024 * 1024,
  disabled,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mobileCameraRef = useRef<HTMLInputElement>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraSupported, setCameraSupported] = useState(true);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraSupported(false);
    }
  }, []);

  const addFiles = useCallback(
    (incoming: File[]) => {
      setWarning(null);
      const remaining = maxFiles - items.length;
      if (incoming.length > remaining) {
        setWarning("Maximum 5 files allowed. Remove a file to add another.");
      }
      const slice = incoming.slice(0, remaining);
      const newItems: AttachmentItem[] = [];
      for (const file of slice) {
        if (!ACCEPTED_TYPES.includes(file.type)) {
          newItems.push({
            file,
            preview: "",
            status: "error",
            error: "File type not supported. Use JPG, PNG, WEBP or PDF",
          });
          continue;
        }
        if (file.size > maxSize) {
          newItems.push({
            file,
            preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
            status: "error",
            error: "File too large — max 5MB",
          });
          continue;
        }
        newItems.push({
          file,
          preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
          status: "pending",
        });
      }
      onChange([...items, ...newItems]);
    },
    [items, onChange, maxFiles, maxSize]
  );

  const onDrop = useCallback((accepted: File[]) => addFiles(accepted), [addFiles]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED,
    maxSize,
    noClick: true,
    noKeyboard: true,
    disabled: disabled || items.length >= maxFiles,
  });

  const remove = (idx: number) => {
    const next = [...items];
    if (next[idx].preview) URL.revokeObjectURL(next[idx].preview);
    next.splice(idx, 1);
    onChange(next);
    setWarning(null);
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleCameraClick = () => {
    if (isMobile()) {
      mobileCameraRef.current?.click();
    } else {
      setCameraOpen(true);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) addFiles(files);
    e.target.value = "";
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleUploadClick}
          disabled={disabled || items.length >= maxFiles}
          className="min-h-11 flex-1"
        >
          <Paperclip className="h-4 w-4 mr-2" />
          Upload Files
        </Button>
        {cameraSupported && (
          <Button
            type="button"
            variant="outline"
            onClick={handleCameraClick}
            disabled={disabled || items.length >= maxFiles}
            className="min-h-11 flex-1"
          >
            <Camera className="h-4 w-4 mr-2" />
            Take Photo
          </Button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={handleFileInput}
      />
      <input
        ref={mobileCameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileInput}
      />

      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed rounded-lg p-6 text-center transition-colors bg-muted/30",
          isDragActive ? "border-primary bg-primary/5" : "border-border",
          (disabled || items.length >= maxFiles) && "opacity-50"
        )}
      >
        <input {...getInputProps()} />
        <Upload className="h-7 w-7 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-foreground">or drag and drop files here</p>
        <p className="text-xs text-muted-foreground mt-1">
          JPG, PNG, WEBP, PDF · max {maxFiles} files · {(maxSize / 1024 / 1024).toFixed(0)}MB each
        </p>
      </div>

      {warning && (
        <div className="text-xs text-destructive flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" />
          {warning}
        </div>
      )}

      {items.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {items.map((item, idx) => (
            <div key={idx} className="relative shrink-0 w-28">
              <div className="relative h-28 w-28 rounded-lg border bg-muted overflow-hidden flex items-center justify-center">
                {item.file.type.startsWith("image/") && item.preview ? (
                  <img src={item.preview} alt={item.file.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center text-muted-foreground p-2">
                    <FileText className="h-8 w-8" />
                    <span className="text-[10px] mt-1">PDF</span>
                  </div>
                )}

                {item.status === "uploading" && (
                  <div className="absolute inset-0 bg-background/70 flex flex-col items-center justify-center gap-1">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    {typeof item.progress === "number" && (
                      <div className="w-20 h-1 bg-border rounded overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${item.progress}%` }} />
                      </div>
                    )}
                  </div>
                )}
                {item.status === "success" && (
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-green-500" />
                )}
                {item.status === "error" && (
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-destructive" />
                )}

                {item.status !== "uploading" && (
                  <button
                    type="button"
                    onClick={() => remove(idx)}
                    className="absolute top-1 right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center hover:opacity-90"
                    aria-label="Remove"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <p className="text-[10px] truncate mt-1 font-medium" title={item.file.name}>
                {item.file.name}
              </p>
              <p className="text-[10px] text-muted-foreground">{formatSize(item.file.size)}</p>
              {item.status === "error" && (
                <p className="text-[10px] text-destructive mt-0.5">{item.error || "Upload failed — tap to retry"}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <CameraDialog
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onCapture={(file) => {
          addFiles([file]);
          setCameraOpen(false);
        }}
        onUnsupported={() => {
          setCameraSupported(false);
          setCameraOpen(false);
        }}
      />
    </div>
  );
}

function CameraDialog({
  open,
  onOpenChange,
  onCapture,
  onUnsupported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCapture: (file: File) => void;
  onUnsupported: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [snapshot, setSnapshot] = useState<{ url: string; blob: Blob } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setSnapshot(null);

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (e) {
        setError("Camera not available. Please upload a file instead.");
        setTimeout(() => onUnsupported(), 1500);
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open, onUnsupported]);

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      setSnapshot({ url, blob });
    }, "image/jpeg", 0.92);
  };

  const usePhoto = () => {
    if (!snapshot) return;
    const file = new File([snapshot.blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
    URL.revokeObjectURL(snapshot.url);
    setSnapshot(null);
    onCapture(file);
  };

  const retake = () => {
    if (snapshot) URL.revokeObjectURL(snapshot.url);
    setSnapshot(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Take Photo</DialogTitle>
        </DialogHeader>
        {error ? (
          <div className="text-sm text-destructive text-center py-6">{error}</div>
        ) : snapshot ? (
          <div className="space-y-3">
            <img src={snapshot.url} alt="Captured" className="w-full rounded-lg border" />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={retake}>Retake</Button>
              <Button className="flex-1" onClick={usePhoto}>Use Photo</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
              <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            </div>
            <div className="flex justify-center">
              <button
                type="button"
                onClick={capture}
                className="h-14 w-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90 ring-4 ring-primary/20"
                aria-label="Capture"
              >
                <Circle className="h-6 w-6" fill="currentColor" />
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
