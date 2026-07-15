import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Mic, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  required?: boolean;
  onAudioRecorded?: (blob: Blob | null, durationSec: number) => void;
}

function pickMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const m of candidates) {
    if (typeof MediaRecorder !== "undefined" && (MediaRecorder as any).isTypeSupported?.(m)) return m;
  }
  return "";
}

export function VoiceDescriptionInput({
  value, onChange, placeholder = "Provide detailed information...", disabled, rows = 4, required, onAudioRecorded,
}: Props) {
  const [recState, setRecState] = useState<"idle" | "recording" | "processing">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [permDenied, setPermDenied] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number>(0);

  const timerRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);

  const supported = typeof MediaRecorder !== "undefined";

  useEffect(() => () => {
    try { mediaRecorderRef.current?.stop(); } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const startRecording = async () => {
    setPermDenied(false);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setPermDenied(true);
      return;
    }
    streamRef.current = stream;

    const mime = pickMime();
    chunksRef.current = [];
    try {
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const type = mr.mimeType || mime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        const duration = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setAudioDuration(duration);
        onAudioRecorded?.(blob, duration);
        stopStream();
        if (timerRef.current) clearInterval(timerRef.current);
        setRecState("idle");
      };
      mediaRecorderRef.current = mr;
      mr.start(250);
      startTimeRef.current = Date.now();
    } catch {
      stopStream();
      setRecState("idle");
      return;
    }

    setRecState("recording");
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  };

  const stopRecording = () => {
    try { mediaRecorderRef.current?.stop(); } catch {}
  };

  const toggle = () => {
    if (recState === "recording") stopRecording();
    else if (recState === "idle") startRecording();
  };

  const clearAudio = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setAudioDuration(0);
    onAudioRecorded?.(null, 0);
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Description {required && "*"}</label>
      <div className="relative">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          required={required}
          disabled={disabled}
          className={cn(
            supported && "pr-12 pb-12",
            recState === "recording" && "border-red-500 focus-visible:ring-red-500"
          )}
        />
        {supported && (
          <>
            {recState === "recording" && (
              <div className="absolute bottom-2 right-12 text-xs font-mono text-red-500 bg-background/80 px-1.5 py-0.5 rounded">
                {fmt(elapsed)}
              </div>
            )}
            <button
              type="button"
              onClick={toggle}
              disabled={recState === "processing" || disabled}
              title={
                permDenied
                  ? "Microphone access denied. Enable it in browser settings."
                  : recState === "recording"
                  ? "Click to stop"
                  : "Click to record your voice"
              }
              className={cn(
                "absolute bottom-2 right-2 h-8 w-8 rounded-full flex items-center justify-center transition-all border",
                recState === "idle" && "bg-background text-muted-foreground border-input hover:bg-muted",
                recState === "recording" && "bg-red-500 text-white border-red-500 animate-pulse shadow-[0_0_0_4px_rgba(239,68,68,0.25)]",
                recState === "processing" && "bg-background text-muted-foreground border-input opacity-70"
              )}
              aria-label="Voice recording"
            >
              {recState === "processing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
            </button>
          </>
        )}
      </div>

      {audioUrl && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
          <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Mic className="h-4 w-4" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium">Voice Recording</span>
            <span className="text-xs text-muted-foreground">{fmt(audioDuration)}</span>
          </div>
          <audio src={audioUrl} controls className="h-9 flex-1 min-w-0" />
          <button
            type="button"
            onClick={clearAudio}
            className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
            title="Remove recording"
            aria-label="Remove recording"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}

      {permDenied && (
        <p className="text-xs text-destructive">
          Microphone access denied. Enable it in browser settings.
        </p>
      )}
    </div>
  );
}
