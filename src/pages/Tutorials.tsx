import { useEffect, useMemo, useRef, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import {
  Play, Video, Upload, Search, MoreVertical, Pencil, Eye, EyeOff,
  ArrowUp, ArrowDown, Trash2, Shield, X, Plus,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/contexts/PermissionsContext";
import { toast } from "sonner";

interface TutorialVideo {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  video_url: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  file_size_mb: number | null;
  uploaded_by: string | null;
  is_published: boolean;
  view_count: number;
  display_order: number;
  created_at: string;
  updated_at: string;
}

function formatDuration(s: number | null) {
  if (!s || s <= 0) return null;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return "Added today";
  if (d === 1) return "Added 1 day ago";
  if (d < 30) return `Added ${d} days ago`;
  const mo = Math.floor(d / 30);
  if (mo === 1) return "Added 1 month ago";
  if (mo < 12) return `Added ${mo} months ago`;
  const y = Math.floor(d / 365);
  return `Added ${y} year${y > 1 ? "s" : ""} ago`;
}

function isNew(iso: string) {
  return Date.now() - new Date(iso).getTime() < 7 * 86400000;
}

export default function Tutorials() {
  const { user } = useAuth();
  const { isSuperAdmin } = usePermissions();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [playingVideo, setPlayingVideo] = useState<TutorialVideo | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<TutorialVideo | null>(null);
  const [deleting, setDeleting] = useState<TutorialVideo | null>(null);

  const { data: videos = [], isLoading } = useQuery<TutorialVideo[]>({
    queryKey: ["tutorial-videos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tutorial_videos" as any)
        .select("*")
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as TutorialVideo[];
    },
  });

  const categories = useMemo(() => {
    const set = new Set<string>();
    videos.forEach(v => { if (v.category) set.add(v.category); });
    return ["All", ...Array.from(set).sort()];
  }, [videos]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return videos.filter(v => {
      if (activeCategory !== "All" && v.category !== activeCategory) return false;
      if (q && !`${v.title} ${v.description ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [videos, search, activeCategory]);

  const togglePublish = useMutation({
    mutationFn: async (v: TutorialVideo) => {
      const { error } = await supabase
        .from("tutorial_videos" as any)
        .update({ is_published: !v.is_published })
        .eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tutorial-videos"] });
      toast.success("Updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reorder = useMutation({
    mutationFn: async ({ v, dir }: { v: TutorialVideo; dir: -1 | 1 }) => {
      const sorted = [...videos].sort((a, b) => a.display_order - b.display_order || a.created_at.localeCompare(b.created_at));
      const idx = sorted.findIndex(x => x.id === v.id);
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= sorted.length) return;
      const other = sorted[swapIdx];
      await supabase.from("tutorial_videos" as any).update({ display_order: other.display_order }).eq("id", v.id);
      await supabase.from("tutorial_videos" as any).update({ display_order: v.display_order }).eq("id", other.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tutorial-videos"] }),
  });

  const deleteVideo = useMutation({
    mutationFn: async (v: TutorialVideo) => {
      // Try to delete files from storage (best-effort). Pass the stored URL directly;
      // the server destroys Cloudinary assets and removes legacy local files alike.
      try {
        if (v.video_url) await supabase.storage.from("tutorial-videos").remove([v.video_url]);
      } catch { /* ignore */ }
      if (v.thumbnail_url) {
        try {
          await supabase.storage.from("tutorial-thumbnails").remove([v.thumbnail_url]);
        } catch { /* ignore */ }
      }
      const { error } = await supabase.from("tutorial_videos" as any).delete().eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tutorial-videos"] });
      toast.success("Video deleted");
      setDeleting(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppLayout title="Tutorial Videos">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Tutorial Videos</h1>
          <p className="text-muted-foreground">Learn how to use the Ticketing Support Portal</p>
          <p className="text-sm text-muted-foreground">{videos.filter(v => v.is_published || isSuperAdmin).length} videos available</p>
        </div>

        {isSuperAdmin && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Shield className="h-4 w-4 text-primary" />
                Managing Tutorial Videos
              </div>
              <Button onClick={() => { setEditing(null); setUploadOpen(true); }}>
                <Upload className="h-4 w-4 mr-2" /> Upload New Video
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tutorials..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border whitespace-nowrap transition ${
                activeCategory === cat
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => <div key={i} className="h-64 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Video className="h-12 w-12 mx-auto mb-3 opacity-50" />
            {videos.length === 0
              ? "No tutorials available yet. Check back soon!"
              : "No videos match your search. Try different keywords."}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(v => (
              <VideoCard
                key={v.id}
                video={v}
                isSuperAdmin={isSuperAdmin}
                onPlay={() => setPlayingVideo(v)}
                onEdit={() => { setEditing(v); setUploadOpen(true); }}
                onTogglePublish={() => togglePublish.mutate(v)}
                onMoveUp={() => reorder.mutate({ v, dir: -1 })}
                onMoveDown={() => reorder.mutate({ v, dir: 1 })}
                onDelete={() => setDeleting(v)}
              />
            ))}
          </div>
        )}
      </div>

      {playingVideo && (
        <VideoPlayerModal video={playingVideo} onClose={() => setPlayingVideo(null)} />
      )}

      {uploadOpen && (
        <UploadVideoModal
          existing={editing}
          existingCategories={categories.filter(c => c !== "All")}
          userId={user?.id}
          onClose={() => { setUploadOpen(false); setEditing(null); }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["tutorial-videos"] });
            setUploadOpen(false);
            setEditing(null);
          }}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this video?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleting?.title}" will be permanently removed along with its files. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleting && deleteVideo.mutate(deleting)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

function VideoCard({
  video, isSuperAdmin, onPlay, onEdit, onTogglePublish, onMoveUp, onMoveDown, onDelete,
}: {
  video: TutorialVideo;
  isSuperAdmin: boolean;
  onPlay: () => void;
  onEdit: () => void;
  onTogglePublish: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const duration = formatDuration(video.duration_seconds);
  return (
    <Card className="overflow-hidden group hover:shadow-lg transition-shadow">
      <div className="relative aspect-video bg-muted cursor-pointer" onClick={onPlay}>
        {video.thumbnail_url ? (
          <img src={video.thumbnail_url} alt={video.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-zinc-800">
            <Video className="h-12 w-12 text-zinc-500" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="h-14 w-14 rounded-full bg-white/90 flex items-center justify-center">
            <Play className="h-7 w-7 text-black ml-0.5" fill="currentColor" />
          </div>
        </div>
        {duration && (
          <Badge className="absolute bottom-2 right-2 bg-black/70 text-white border-0 text-xs">{duration}</Badge>
        )}
        {isNew(video.created_at) && (
          <Badge className="absolute top-2 left-2 bg-emerald-500 text-white border-0">New</Badge>
        )}
        {isSuperAdmin && !video.is_published && (
          <div className="absolute inset-0 bg-zinc-900/70 flex items-center justify-center pointer-events-none">
            <Badge variant="secondary" className="text-sm">Unpublished</Badge>
          </div>
        )}
        {isSuperAdmin && (
          <div className="absolute top-2 right-2" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" className="h-8 w-8 bg-white/90 hover:bg-white text-black">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>
                <DropdownMenuItem onClick={onPlay}><Eye className="h-4 w-4 mr-2" /> Preview</DropdownMenuItem>
                <DropdownMenuItem onClick={onTogglePublish}>
                  {video.is_published
                    ? <><EyeOff className="h-4 w-4 mr-2" /> Unpublish</>
                    : <><Eye className="h-4 w-4 mr-2" /> Publish</>}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onMoveUp}><ArrowUp className="h-4 w-4 mr-2" /> Move Up</DropdownMenuItem>
                <DropdownMenuItem onClick={onMoveDown}><ArrowDown className="h-4 w-4 mr-2" /> Move Down</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="h-4 w-4 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      <CardContent className="p-4 space-y-2">
        <h3 className="font-semibold leading-tight line-clamp-2">{video.title}</h3>
        {video.category && (
          <Badge variant="outline" className="text-xs">{video.category}</Badge>
        )}
        {video.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{video.description}</p>
        )}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
          <span className="flex items-center gap-1"><Eye className="h-3 w-3" /> {video.view_count} views</span>
          <span>{timeAgo(video.created_at)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function VideoPlayerModal({ video, onClose }: { video: TutorialVideo; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const countedRef = useRef(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onTimeUpdate = () => {
      if (!countedRef.current && el.currentTime >= 5) {
        countedRef.current = true;
        supabase.rpc("increment_tutorial_view" as any, { _id: video.id }).then(() => { /* noop */ });
      }
    };
    el.addEventListener("timeupdate", onTimeUpdate);
    return () => el.removeEventListener("timeupdate", onTimeUpdate);
  }, [video.id]);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col overflow-auto">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>
      <div className="max-w-5xl mx-auto w-full p-6 pt-16 space-y-4">
        <video
          ref={videoRef}
          src={video.video_url}
          poster={video.thumbnail_url ?? undefined}
          controls
          autoPlay
          className="w-full rounded-lg bg-black aspect-video"
        />
        <div className="text-white space-y-3">
          <h2 className="text-2xl font-bold">{video.title}</h2>
          <div className="flex items-center gap-3 flex-wrap">
            {video.category && (
              <Badge className="bg-primary/20 text-primary border-primary/30">{video.category}</Badge>
            )}
            <span className="text-sm text-white/70 flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" /> {video.view_count} views
            </span>
            <span className="text-sm text-white/70">{timeAgo(video.created_at)}</span>
          </div>
          {video.description && (
            <p className="text-white/80 whitespace-pre-wrap">{video.description}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function UploadVideoModal({
  existing, existingCategories, userId, onClose, onSaved,
}: {
  existing: TutorialVideo | null;
  existingCategories: string[];
  userId: string | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [category, setCategory] = useState(existing?.category ?? "");
  const [newCategoryMode, setNewCategoryMode] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [publish, setPublish] = useState(existing ? existing.is_published : true);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  const finalCategory = newCategoryMode ? newCategory.trim() : category;

  const handleVideoSelect = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 500 * 1024 * 1024) {
      toast.error("Video must be 500MB or less");
      return;
    }
    setVideoFile(f);
  };

  const submit = async () => {
    if (!title.trim()) { toast.error("Title is required"); return; }
    if (!finalCategory) { toast.error("Category is required"); return; }
    if (!existing && !videoFile) { toast.error("Please select a video file"); return; }

    setBusy(true);
    try {
      let video_url = existing?.video_url ?? "";
      let thumbnail_url = existing?.thumbnail_url ?? null;
      let duration_seconds = existing?.duration_seconds ?? null;
      let file_size_mb = existing?.file_size_mb ?? null;

      if (videoFile) {
        const id = crypto.randomUUID();
        const safeName = videoFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${id}/${safeName}`;
        setProgress(10);
        const { data: upData, error: upErr } = await supabase.storage
          .from("tutorial-videos")
          .upload(path, videoFile, { contentType: videoFile.type, upsert: false });
        if (upErr) throw upErr;
        setProgress(70);
        const { data: pub } = supabase.storage.from("tutorial-videos").getPublicUrl((upData as any)?.path ?? path);
        video_url = pub.publicUrl;
        file_size_mb = +(videoFile.size / 1024 / 1024).toFixed(2);

        // Try to read duration
        try {
          duration_seconds = await new Promise<number | null>((resolve) => {
            const el = document.createElement("video");
            el.preload = "metadata";
            el.onloadedmetadata = () => resolve(Math.round(el.duration) || null);
            el.onerror = () => resolve(null);
            el.src = URL.createObjectURL(videoFile);
          });
        } catch { /* ignore */ }

        // If replacing, delete old file (Cloudinary asset or legacy local file).
        if (existing?.video_url) {
          try {
            await supabase.storage.from("tutorial-videos").remove([existing.video_url]);
          } catch { /* ignore */ }
        }
      }

      if (thumbFile) {
        const id = crypto.randomUUID();
        const safeName = thumbFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${id}/${safeName}`;
        const { data: tData, error: tErr } = await supabase.storage
          .from("tutorial-thumbnails")
          .upload(path, thumbFile, { contentType: thumbFile.type, upsert: false });
        if (tErr) throw tErr;
        const { data: pub } = supabase.storage.from("tutorial-thumbnails").getPublicUrl((tData as any)?.path ?? path);
        thumbnail_url = pub.publicUrl;
      }

      setProgress(90);

      if (existing) {
        const { error } = await supabase.from("tutorial_videos" as any).update({
          title: title.trim(),
          description: description.trim() || null,
          category: finalCategory,
          video_url,
          thumbnail_url,
          duration_seconds,
          file_size_mb,
          is_published: publish,
        }).eq("id", existing.id);
        if (error) throw error;
        toast.success("Video updated");
      } else {
        const { error } = await supabase.from("tutorial_videos" as any).insert({
          title: title.trim(),
          description: description.trim() || null,
          category: finalCategory,
          video_url,
          thumbnail_url,
          duration_seconds,
          file_size_mb,
          uploaded_by: userId,
          is_published: publish,
          display_order: 0,
        });
        if (error) throw error;
        toast.success("Video uploaded successfully!");
      }

      setProgress(100);
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Tutorial Video" : "Upload Tutorial Video"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Video File {!existing && <span className="text-destructive">*</span>}</Label>
            <label className="block border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors">
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm">
                {videoFile
                  ? `${videoFile.name} (${(videoFile.size / 1024 / 1024).toFixed(1)} MB)`
                  : existing
                    ? "Click to replace current video (optional)"
                    : "Click to select or drag and drop video here"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">MP4, WEBM, MOV — max 500MB</p>
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                className="hidden"
                onChange={(e) => handleVideoSelect(e.target.files?.[0])}
              />
            </label>
            {progress > 0 && (
              <div>
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-muted-foreground mt-1">Uploading video... {progress}%</p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Thumbnail Image (optional)</Label>
            <label className="block border border-dashed rounded-lg p-3 text-center cursor-pointer hover:border-primary/50 transition-colors text-sm">
              {thumbFile ? thumbFile.name : "Upload thumbnail image (JPG, PNG — 16:9 recommended)"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => setThumbFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {(thumbFile || existing?.thumbnail_url) && (
              <img
                src={thumbFile ? URL.createObjectURL(thumbFile) : existing!.thumbnail_url!}
                alt="thumbnail"
                className="rounded-md max-h-32 object-contain border"
              />
            )}
          </div>

          <div className="space-y-2">
            <Label>Video Title <span className="text-destructive">*</span></Label>
            <Input
              placeholder="e.g. How to Create a Support Ticket"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Category <span className="text-destructive">*</span></Label>
            {newCategoryMode ? (
              <div className="flex gap-2">
                <Input
                  placeholder="New category name"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  autoFocus
                />
                <Button variant="outline" type="button" onClick={() => { setNewCategoryMode(false); setNewCategory(""); }}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Select value={category} onValueChange={(v) => {
                if (v === "__new__") { setNewCategoryMode(true); setCategory(""); }
                else setCategory(v);
              }}>
                <SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger>
                <SelectContent>
                  {existingCategories.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                  <SelectItem value="__new__"><Plus className="h-3 w-3 inline mr-1" /> Add new category...</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              placeholder="Briefly describe what this video covers..."
              maxLength={300}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <p className="text-xs text-muted-foreground text-right">{description.length}/300</p>
          </div>

          <div className="flex items-center justify-between p-3 bg-muted/40 rounded-lg">
            <Label className="font-normal">Publish immediately</Label>
            <Switch checked={publish} onCheckedChange={setPublish} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Saving..." : existing ? "Save Changes" : "Upload Video"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
