import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Camera, Eye, EyeOff, Loader2, Lock, Save } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

const baseRoleLabels: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  hod: "HOD",
  user: "User",
  assigned_person: "Assigned Person",
};
const roleBadgeVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  super_admin: "destructive",
  admin: "default",
  hod: "secondary",
  user: "outline",
  assigned_person: "secondary",
};
const formatRoleLabel = (key: string) =>
  baseRoleLabels[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function MyProfileTab() {
  const { user, profile, role, refreshProfile } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [contact, setContact] = useState("");
  const [departmentId, setDepartmentId] = useState<string>("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setName(profile.name || "");
      setUsername(profile.username || "");
      setEmployeeId(profile.employee_id || "");
      setContact(profile.contact || "");
      setDepartmentId(profile.department_id || "");
      setAvatarUrl((profile as any).profile_picture || null);
    }
  }, [profile]);

  const { data: departments } = useQuery({
    queryKey: ["all-departments-myprofile"],
    queryFn: async () => (await supabase.from("departments").select("id,name,is_active")).data || [],
  });
  const { data: units } = useQuery({
    queryKey: ["all-units-myprofile"],
    queryFn: async () => (await supabase.from("units").select("id,name")).data || [],
  });

  const deptName = departments?.find((d) => d.id === profile?.department_id)?.name || "Not Assigned";
  const unitName = units?.find((u) => u.id === (profile as any)?.unit_id)?.name || "Not Assigned";
  const initials = (name || profile?.name || user?.email || "?").split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    if (!["image/jpeg", "image/png", "image/jpg", "image/webp"].includes(file.type)) {
      toast({ title: "Invalid file", description: "Only JPG, PNG or WEBP allowed.", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum size is 5MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    // Remember the current picture so we can delete it from Cloudinary after replacing.
    const previousUrl = avatarUrl;
    try {
      const ext = file.name.split(".").pop();
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { data: upData, error: upErr } = await supabase.storage.from("profile-pictures").upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) throw upErr;
      // Cloudinary returns the secure_url as upData.path; local storage returns the object path.
      const { data: urlData } = supabase.storage.from("profile-pictures").getPublicUrl((upData as any)?.path ?? path);
      const publicUrl = urlData.publicUrl;
      const { error: updErr } = await supabase.from("profiles").update({ profile_picture: publicUrl } as any).eq("user_id", user.id);
      if (updErr) throw updErr;
      setAvatarUrl(publicUrl);
      await refreshProfile();
      // Best-effort cleanup of the old image (skip if unchanged); failures are non-fatal.
      if (previousUrl && previousUrl !== publicUrl) {
        supabase.storage.from("profile-pictures").remove([previousUrl]).catch(() => {});
      }
      toast({ title: "Profile picture updated" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setPasswordError("");
    if (!name.trim()) return toast({ title: "Full Name is required", variant: "destructive" });
    if (!username.trim()) return toast({ title: "Username is required", variant: "destructive" });

    const wantsPasswordChange = currentPassword || newPassword || confirmPassword;
    if (wantsPasswordChange) {
      if (!currentPassword) return setPasswordError("Current password is required");
      if (newPassword.length < 6) return setPasswordError("New password must be at least 6 characters");
      if (newPassword !== confirmPassword) return setPasswordError("New passwords do not match");
    }

    setSaving(true);
    try {
      if (wantsPasswordChange && user?.email) {
        const { error: reauthErr } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
        if (reauthErr) {
          setPasswordError("Current password is incorrect");
          setSaving(false);
          return;
        }
        const { error: pwErr } = await supabase.auth.updateUser({ password: newPassword });
        if (pwErr) throw pwErr;
      }

      const { error: profErr } = await supabase
        .from("profiles")
        .update({
          name: name.trim(),
          username: username.trim(),
          employee_id: employeeId.trim() || null,
          contact: contact.trim() || null,
          department_id: departmentId || null,
        } as any)
        .eq("user_id", user!.id);
      if (profErr) throw profErr;

      await refreshProfile();
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      toast({ title: "Profile updated successfully" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <TooltipProvider>
      <Card>
        <CardHeader>
          <CardTitle>My Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-8">
          {/* Section 1: Avatar + basic info */}
          <div className="flex items-center gap-6">
            <div className="relative group cursor-pointer" onClick={handleAvatarClick}>
              <Avatar className="h-24 w-24 ring-2 ring-primary/30">
                {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
                <AvatarFallback className="text-xl font-bold bg-primary text-primary-foreground">{initials}</AvatarFallback>
              </Avatar>
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 group-hover:opacity-100 transition rounded-full">
                {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
              </div>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleFileChange} />
            </div>
            <div className="space-y-1">
              <h2 className="text-2xl font-semibold">{name || profile?.name}</h2>
              {role && (
                <Badge variant={roleBadgeVariant[role] ?? "outline"}>{formatRoleLabel(role)}</Badge>
              )}
              <p className="text-sm text-muted-foreground">{user?.email}</p>
              <p className="text-xs text-muted-foreground">Click avatar to upload (JPG/PNG, max 2MB)</p>
            </div>
          </div>

          {/* Section 2: Form */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Full Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Email</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="relative">
                    <Input value={user?.email || ""} readOnly className="bg-muted pr-9 cursor-not-allowed" />
                    <Lock className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </TooltipTrigger>
                <TooltipContent>Email cannot be changed here. Contact admin to update your email.</TooltipContent>
              </Tooltip>
            </div>

            <div className="space-y-2">
              <Label>Username</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>

            <div className="space-y-3 rounded-lg border p-4">
              <Label className="text-base">Change Password</Label>
              <p className="text-xs text-muted-foreground">Leave blank to keep your current password.</p>
              <div className="space-y-2">
                <Label className="text-sm">Current Password</Label>
                <div className="relative">
                  <Input type={showCurrent ? "text" : "password"} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
                  <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm">New Password</Label>
                <div className="relative">
                  <Input type={showNew ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                  <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm">Confirm New Password</Label>
                <div className="relative">
                  <Input type={showConfirm ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                  <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Employee ID</Label>
                <Input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Contact</Label>
                <Input value={contact} onChange={(e) => setContact(e.target.value)} />
              </div>
            </div>


            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Role</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Input value={role ? formatRoleLabel(role) : ""} readOnly className="bg-muted cursor-not-allowed" />
                  </TooltipTrigger>
                  <TooltipContent>Your role is managed by the administrator.</TooltipContent>
                </Tooltip>
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments?.map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Unit</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Input value={unitName} readOnly className="bg-muted cursor-not-allowed" />
                </TooltipTrigger>
                <TooltipContent>Your unit is managed by the administrator.</TooltipContent>
              </Tooltip>
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save Profile
            </Button>
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
