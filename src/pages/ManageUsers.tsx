import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Search, Shield, PlusCircle, Pencil, Trash2, Eye, EyeOff, Loader2, FileUp } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/api/client";
import { useToast } from "@/hooks/use-toast";
import type { AppRole } from "@/integrations/api/types";
import { BulkImportUsersDialog } from "@/components/BulkImportUsersDialog";
import { useAuth } from "@/contexts/AuthContext";

const baseRoleLabels: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  hod: "HOD",
  user: "User",
  assigned_person: "Team Member",
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

// Map a roles-table name (which may be a display label like "HOD" or "Technician",
// or an enum key like "hod") to the canonical role value stored in user_roles.role.
// Keeps the dropdown driven by the dynamic roles table while always assigning a
// valid role value.
const NAME_TO_ROLE: Record<string, AppRole> = {
  "super admin": "super_admin",
  super_admin: "super_admin",
  admin: "admin",
  hod: "hod",
  user: "user",
  "team member": "assigned_person",
  technician: "assigned_person",
  assigned_person: "assigned_person",
  pc: "PC",
  "admin south": "Admin South",
};

const toRoleValue = (name: string): AppRole | null => {
  const k = String(name ?? "").trim().toLowerCase();
  return NAME_TO_ROLE[k] ?? null;
};

interface UserForm {
  name: string;
  email: string;
  username: string;
  password: string;
  employeeId: string;
  contact: string;
  role: AppRole;
  departmentId: string;
  unitId: string;
}

const emptyForm: UserForm = {
  name: "", email: "", username: "", password: "", employeeId: "", contact: "", role: "user", departmentId: "none", unitId: "",
};

export default function ManageUsers() {
  const { toast } = useToast();
  const { allowedUnitIds } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const [formLoading, setFormLoading] = useState(false);

  const { data: profiles, isLoading } = useQuery({
    queryKey: ["all-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").order("name");
      if (error) throw error;
      return data;
    },
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });

  const { data: userRoles, isLoading: rolesLoading } = useQuery({
    queryKey: ["all-user-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("*");
      if (error) throw error;
      return data;
    },
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });

  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data } = await supabase.from("departments").select("*").order("name");
      return data || [];
    },
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });

  const { data: units } = useQuery({
    queryKey: ["units"],
    queryFn: async () => {
      const { data } = await supabase.from("units").select("*").order("name");
      return data || [];
    },
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });

  const { data: rolesList } = useQuery({
    queryKey: ["roles-list"],
    queryFn: async () => {
      const { data } = await (supabase.from("roles" as any).select("name").order("created_at") as any);
      return ((data ?? []) as Array<{ name: string }>).map((r) => r.name);
    },
    refetchOnWindowFocus: false,
  });

  // Roles come ONLY from the dynamic `roles` table. Each entry maps to a valid
  // role value and is de-duplicated so the same role can't appear twice (e.g.
  // a "super_admin" row and a "Super Admin" row both collapse to one option).
  const roleOptions = (() => {
    const seen = new Set<string>();
    const opts: { value: AppRole; label: string }[] = [];
    for (const name of rolesList ?? []) {
      const value = toRoleValue(name);
      if (!value || seen.has(value)) continue;
      seen.add(value);
      opts.push({ value, label: name });
    }
    return opts;
  })();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["all-profiles"] });
    queryClient.invalidateQueries({ queryKey: ["all-user-roles"] });
  };

  const updateRole = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: AppRole }) => {
      const { error } = await supabase.from("user_roles").update({ role: newRole }).eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => { invalidateAll(); toast({ title: "Role Updated" }); },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const updateDepartment = useMutation({
    mutationFn: async ({ userId, departmentId }: { userId: string; departmentId: string | null }) => {
      const { error } = await supabase.from("profiles").update({ department_id: departmentId }).eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => { invalidateAll(); toast({ title: "Department Updated" }); },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const getRoleForUser = (userId: string): AppRole => {
    const found = userRoles?.find((r) => r.user_id === userId);
    return (found?.role as AppRole) || "user";
  };

  const filtered = profiles?.filter((p) => {
    // Soft-deleted/deactivated users keep their profile for audit history but lose all roles.
    // Hide them from User Management so they do not reappear after cache refresh/page reload.
    if (userRoles && !userRoles.some((r) => r.user_id === p.user_id)) return false;

    // Plant access restriction: hide users whose unit isn't allowed for the viewer's role.
    if (allowedUnitIds && p.unit_id && !allowedUnitIds.includes(p.unit_id)) return false;
    if (allowedUnitIds && !p.unit_id) return false;

    const term = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(term) ||
      p.username?.toLowerCase().includes(term) ||
      p.employee_id?.toLowerCase().includes(term)
    );
  });

  const handleAddUser = async () => {
    if (!form.name || !form.email || !form.password) {
      toast({ title: "Error", description: "Name, email, and password are required.", variant: "destructive" });
      return;
    }
    if (!form.unitId) {
      toast({ title: "Error", description: "Please select a unit", variant: "destructive" });
      return;
    }
    setFormLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/functions/v1/admin-create-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          name: form.name,
          username: form.username,
          employeeId: form.employeeId,
          contact: form.contact,
          role: form.role,
          departmentId: form.departmentId,
          unitId: form.unitId,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to create user");
      toast({ title: "User Created", description: `${form.name} has been added successfully.` });
      setAddOpen(false);
      setForm(emptyForm);
      invalidateAll();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setFormLoading(false);
  };

  const handleEditUser = async () => {
    if (!selectedUser) return;
    if (!form.name.trim()) {
      toast({ title: "Error", description: "Name is required.", variant: "destructive" });
      return;
    }
    setFormLoading(true);
    try {
      // Update profile — select() forces the response so RLS rejections surface as errors
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .update({
          name: form.name,
          username: form.username || null,
          employee_id: form.employeeId || null,
          contact: form.contact || null,
          department_id: form.departmentId === "none" ? null : form.departmentId,
          unit_id: form.unitId || null,
        } as any)
        .eq("user_id", selectedUser.user_id)
        .select();

      if (profileError) throw profileError;
      if (!profileData || profileData.length === 0) {
        throw new Error("Profile update was rejected (no rows updated). Check your permissions.");
      }

      // Replace role (no unique constraint on user_id, so delete-then-insert)
      const currentRole = getRoleForUser(selectedUser.user_id);
      if (form.role !== currentRole) {
        const { error: deleteRoleError } = await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", selectedUser.user_id);
        if (deleteRoleError) throw deleteRoleError;

        const { data: roleData, error: roleError } = await supabase
          .from("user_roles")
          .insert({ user_id: selectedUser.user_id, role: form.role })
          .select();
        if (roleError) throw roleError;
        if (!roleData || roleData.length === 0) {
          throw new Error("Role update was rejected. Only Admins/Super Admins can change roles.");
        }
      }

      // Update cache directly with confirmed DB values — no refetch (would race & revert).
      queryClient.setQueryData(["all-profiles"], (old: any[] | undefined) =>
        old?.map((p) => (p.user_id === selectedUser.user_id ? { ...p, ...profileData[0] } : p))
      );
      queryClient.setQueryData(["all-user-roles"], (old: any[] | undefined) => {
        if (!old) return old;
        const exists = old.some((r) => r.user_id === selectedUser.user_id);
        return exists
          ? old.map((r) => (r.user_id === selectedUser.user_id ? { ...r, role: form.role } : r))
          : [...old, { user_id: selectedUser.user_id, role: form.role, id: crypto.randomUUID() }];
      });

      // Update email/password via edge function if provided
      if ((form.email && form.email.trim()) || (form.password && form.password.length > 0)) {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${import.meta.env.VITE_API_URL}/functions/v1/admin-update-user-credentials`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            userId: selectedUser.user_id,
            email: form.email?.trim() || undefined,
            password: form.password || undefined,
          }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || "Failed to update credentials");
      }

      toast({ title: "User updated", description: `${form.name}'s details have been saved.` });
      setEditOpen(false);
      setSelectedUser(null);
    } catch (err: any) {
      toast({ title: "Save failed", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;
    setFormLoading(true);

    // Snapshot for rollback if the server rejects
    const prevProfiles = queryClient.getQueryData<any[]>(["all-profiles"]);
    const prevRoles = queryClient.getQueryData<any[]>(["all-user-roles"]);

    // Optimistically remove from cache immediately
    queryClient.setQueryData(["all-profiles"], (old: any[] | undefined) =>
      old?.filter((p) => p.user_id !== selectedUser.user_id)
    );
    queryClient.setQueryData(["all-user-roles"], (old: any[] | undefined) =>
      old?.filter((r) => r.user_id !== selectedUser.user_id)
    );

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/functions/v1/admin-delete-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ userId: selectedUser.user_id }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to delete user");

      // DO NOT invalidate here — soft-deleted users still exist in `profiles` and would
      // reappear in the list. The optimistic removal above is the source of truth.
      toast({
        title: result.mode === "deactivated" ? "User deactivated" : "User deleted",
        description: result.mode === "deactivated"
          ? `${selectedUser.name}'s access has been revoked. Audit history is preserved.`
          : `${selectedUser.name} has been removed.`,
      });
      setDeleteOpen(false);
      setSelectedUser(null);
    } catch (err: any) {
      // Roll back optimistic removal so the row reappears
      queryClient.setQueryData(["all-profiles"], prevProfiles);
      queryClient.setQueryData(["all-user-roles"], prevRoles);
      toast({ title: "Delete failed", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setFormLoading(false);
    }
  };

  const openEdit = (p: any) => {
    setSelectedUser(p);
    setForm({
      name: p.name,
      email: "",
      username: p.username || "",
      password: "",
      employeeId: p.employee_id || "",
      contact: p.contact || "",
      role: getRoleForUser(p.user_id),
      departmentId: p.department_id || "none",
      unitId: p.unit_id || "",
    });
    setEditOpen(true);
  };

  const getInitials = (name: string) => name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);

  const getDeptName = (deptId: string | null) => {
    if (!deptId) return "—";
    return departments?.find(d => d.id === deptId)?.name || "—";
  };

  const getUnitName = (unitId: string | null) => {
    if (!unitId) return "—";
    return units?.find(u => u.id === unitId)?.name || "—";
  };

  return (
    <AppLayout title="Manage Users">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">User Management</h2>
            <p className="text-sm text-muted-foreground">Manage roles and department assignments.</p>
          </div>
          <div className="flex gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search users..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Button variant="outline" onClick={() => setBulkOpen(true)}>
              <FileUp className="h-4 w-4 mr-2" /> Bulk Import
            </Button>
            <Button onClick={() => { setForm(emptyForm); setAddOpen(true); }}>
              <PlusCircle className="h-4 w-4 mr-2" /> Add User
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4" /> All Users ({filtered?.length || 0})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading || rolesLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Employee ID</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered?.map((p) => {
                      const currentRole = getRoleForUser(p.user_id);
                      return (
                        <TableRow key={p.id} className="hover:bg-muted/50">
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <Avatar className="h-8 w-8">
                                <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">{getInitials(p.name)}</AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="font-medium text-sm">{p.name}</p>
                                <p className="text-xs text-muted-foreground">{p.username || "—"}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{p.employee_id || "—"}</TableCell>
                          <TableCell className="text-sm">{p.contact || "—"}</TableCell>
                          <TableCell>
                            <Badge variant={roleBadgeVariant[currentRole] ?? "outline"}>{formatRoleLabel(currentRole)}</Badge>
                          </TableCell>
                          <TableCell className="text-sm">{getDeptName(p.department_id)}</TableCell>
                          <TableCell className="text-sm">{getUnitName(p.unit_id)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(p)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => { setSelectedUser(p); setDeleteOpen(true); }}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {filtered?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No users found.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add User Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription>Create a new user account.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Full Name *</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="John Doe" />
            </div>
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="john@company.com" />
            </div>
            <div className="space-y-2">
              <Label>Username</Label>
              <Input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="john.doe" />
            </div>
            <div className="space-y-2">
              <Label>Password *</Label>
              <div className="relative">
                <Input type={showPassword ? "text" : "password"} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Min 6 characters" className="pr-10" />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Employee ID</Label>
                <Input value={form.employeeId} onChange={e => setForm({ ...form, employeeId: e.target.value })} placeholder="EMP-001" />
              </div>
              <div className="space-y-2">
                <Label>Contact</Label>
                <Input value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} placeholder="+91..." />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as AppRole })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Select value={form.departmentId} onValueChange={(v) => setForm({ ...form, departmentId: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {departments?.filter((d: any) => d.is_active !== false).map(d => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Unit *</Label>
              <Select value={form.unitId} onValueChange={(v) => setForm({ ...form, unitId: v })}>
                <SelectTrigger><SelectValue placeholder="Select Unit" /></SelectTrigger>
                <SelectContent>
                  {units?.map(u => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={formLoading}>Cancel</Button>
            <Button onClick={handleAddUser} disabled={formLoading}>
              {formLoading ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>) : "Save User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Update user details for {selectedUser?.name}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Leave blank to keep current" />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <div className="relative">
                <Input type={showPassword ? "text" : "password"} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Leave blank to keep current" className="pr-10" />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Username</Label>
                <Input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Employee ID</Label>
                <Input value={form.employeeId} onChange={e => setForm({ ...form, employeeId: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Contact</Label>
              <Input value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as AppRole })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Select value={form.departmentId} onValueChange={(v) => setForm({ ...form, departmentId: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {departments?.filter((d: any) => d.is_active !== false).map(d => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Unit *</Label>
              <Select value={form.unitId} onValueChange={(v) => setForm({ ...form, unitId: v })}>
                <SelectTrigger><SelectValue placeholder="Select Unit" /></SelectTrigger>
                <SelectContent>
                  {units?.map(u => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={formLoading}>Cancel</Button>
            <Button onClick={handleEditUser} disabled={formLoading}>
              {formLoading ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>) : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{selectedUser?.name}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={formLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteUser} disabled={formLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {formLoading ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Deleting...</>) : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <BulkImportUsersDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        departments={(departments || []).filter((d: any) => d.is_active !== false)}
        units={units || []}
        onComplete={invalidateAll}
      />
    </AppLayout>
  );
}
