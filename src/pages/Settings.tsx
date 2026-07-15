import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Building2, PlusCircle, Pencil, Trash2, Save, Factory, Check, X, Bot } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/api/client";
import { useToast } from "@/hooks/use-toast";

import { RolesPermissionsTab } from "@/components/settings/RolesPermissionsTab";
import { GoogleSheetsSync } from "@/components/settings/GoogleSheetsSync";
import { AIConfigTab } from "@/components/settings/AIConfigTab";
import { formatDate } from "@/utils/dateFormat";


export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Company Settings
  const [companyName, setCompanyName] = useState("Amsons Group");
  const [supportEmail, setSupportEmail] = useState("support@ticketing.com");

  // Department management
  const [deptDialogOpen, setDeptDialogOpen] = useState(false);
  const [deptDeleteOpen, setDeptDeleteOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<any>(null);
  const [deptName, setDeptName] = useState("");

  // Unit management
  const [unitDialogOpen, setUnitDialogOpen] = useState(false);
  const [unitDeleteOpen, setUnitDeleteOpen] = useState(false);
  const [pendingUnit, setPendingUnit] = useState<any>(null);
  const [newUnitName, setNewUnitName] = useState("");
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [editingUnitName, setEditingUnitName] = useState("");

  // SLA Config
  const [slaEnabled, setSlaEnabled] = useState(true);
  const [slaConfig, setSlaConfig] = useState({
    low: { response: 24, resolution: 72 },
    medium: { response: 12, resolution: 48 },
    high: { response: 4, resolution: 24 },
    critical: { response: 1, resolution: 8 },
  });

  // Notifications
  const [notifAssignment, setNotifAssignment] = useState(true);
  const [notifStatusChange, setNotifStatusChange] = useState(true);
  const [notifSlaBreach, setNotifSlaBreach] = useState(true);
  const [notifDailySummary, setNotifDailySummary] = useState(false);

  // Security
  const [minPasswordLength, setMinPasswordLength] = useState([8]);
  const [forcePasswordChange, setForcePasswordChange] = useState(false);
  const [sessionTimeout, setSessionTimeout] = useState("4hr");

  const { data: departments, isLoading: deptsLoading } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data } = await supabase.from("departments").select("*").order("name");
      return data || [];
    },
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });

  const { data: units, isLoading: unitsLoading } = useQuery({
    queryKey: ["units"],
    queryFn: async () => {
      const { data } = await supabase.from("units").select("*").order("name");
      return data || [];
    },
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });

  const addUnit = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase.from("units").insert({ name }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (newUnit) => {
      queryClient.setQueryData<any[]>(["units"], (old) => [...(old ?? []), newUnit].sort((a, b) => a.name.localeCompare(b.name)));
      toast({ title: "Unit Added" });
      setUnitDialogOpen(false);
      setNewUnitName("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateUnit = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from("units").update({ name }).eq("id", id);
      if (error) throw error;
      return { id, name };
    },
    onSuccess: ({ id, name }) => {
      queryClient.setQueryData<any[]>(["units"], (old) =>
        (old ?? []).map((u) => (u.id === id ? { ...u, name } : u)).sort((a, b) => a.name.localeCompare(b.name))
      );
      toast({ title: "Unit Updated" });
      setEditingUnitId(null);
      setEditingUnitName("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteUnit = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("units").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ["units"] });
      const previousUnits = queryClient.getQueryData<any[]>(["units"]);
      queryClient.setQueryData(["units"], (old: any[] | undefined) =>
        old?.filter((u) => u.id !== id) ?? []
      );
      return { previousUnits };
    },
    onSuccess: () => { toast({ title: "Unit Deleted" }); setUnitDeleteOpen(false); setPendingUnit(null); },
    onError: (e: Error, _id, context) => {
      queryClient.setQueryData(["units"], context?.previousUnits);
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const addDept = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("departments").insert({ name });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["departments"] }); toast({ title: "Department Added" }); setDeptDialogOpen(false); setDeptName(""); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateDept = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from("departments").update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["departments"] }); toast({ title: "Department Updated" }); setDeptDialogOpen(false); setEditingDept(null); setDeptName(""); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteDept = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("departments").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ["departments"] });
      const previousDepartments = queryClient.getQueryData<any[]>(["departments"]);
      queryClient.setQueryData(["departments"], (old: any[] | undefined) =>
        old?.filter((dept) => dept.id !== id) ?? []
      );
      return { previousDepartments };
    },
    onSuccess: () => { toast({ title: "Department Deleted" }); setDeptDeleteOpen(false); setEditingDept(null); },
    onError: (e: Error, _id, context) => {
      queryClient.setQueryData(["departments"], context?.previousDepartments);
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const toggleDeptActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("departments").update({ is_active } as any).eq("id", id);
      if (error) throw error;
      return { id, is_active };
    },
    onMutate: async ({ id, is_active }) => {
      await queryClient.cancelQueries({ queryKey: ["departments"] });
      const previous = queryClient.getQueryData<any[]>(["departments"]);
      queryClient.setQueryData(["departments"], (old: any[] | undefined) =>
        old?.map((d) => (d.id === id ? { ...d, is_active } : d)) ?? []
      );
      return { previous };
    },
    onSuccess: ({ is_active }) => {
      toast({ title: is_active ? "Department marked as Active" : "Department marked as Inactive" });
      queryClient.invalidateQueries({ queryKey: ["departments"] });
    },
    onError: (e: Error, _v, context: any) => {
      queryClient.setQueryData(["departments"], context?.previous);
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const handleSaveCompany = () => toast({ title: "Company Settings Saved" });
  const handleSaveSLA = () => toast({ title: "SLA Configuration Saved" });
  const handleSaveNotifications = () => toast({ title: "Notification Preferences Saved" });
  const handleSaveSecurity = () => toast({ title: "Security Settings Saved" });

  return (
    <AppLayout title="Settings">
      <div className="max-w-4xl mx-auto">
        <Tabs defaultValue="company" className="space-y-6">
          <TabsList className="grid grid-cols-8 w-full">
            <TabsTrigger value="company">Company</TabsTrigger>
            <TabsTrigger value="units">Units</TabsTrigger>
            <TabsTrigger value="departments">Departments</TabsTrigger>
            <TabsTrigger value="sla">SLA Config</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="ai-config"><Bot className="h-3.5 w-3.5 mr-1" />AI Config</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
            <TabsTrigger value="roles">Roles & Permissions</TabsTrigger>
          </TabsList>




          {/* Company */}
          <TabsContent value="company">
            <Card>
              <CardHeader><CardTitle>Company Settings</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Company Name</Label>
                  <Input value={companyName} onChange={e => setCompanyName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Support Email</Label>
                  <Input type="email" value={supportEmail} onChange={e => setSupportEmail(e.target.value)} />
                </div>
                <div className="flex justify-end">
                  <Button onClick={handleSaveCompany}><Save className="h-4 w-4 mr-2" /> Save</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Units */}
          <TabsContent value="units">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><Factory className="h-4 w-4" /> Manage Units</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">Add, edit or remove units available in the ticket form.</p>
                </div>
                <Button size="sm" onClick={() => { setNewUnitName(""); setUnitDialogOpen(true); }}>
                  <PlusCircle className="h-4 w-4 mr-2" /> Add Unit
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unit Name</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unitsLoading && (
                      <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">Loading units…</TableCell></TableRow>
                    )}
                    {!unitsLoading && units?.map((u: any) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">
                          {editingUnitId === u.id ? (
                            <Input
                              value={editingUnitName}
                              onChange={(e) => setEditingUnitName(e.target.value)}
                              autoFocus
                              className="h-8"
                            />
                          ) : (
                            u.name
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(u.created_at)}</TableCell>
                        <TableCell className="text-right">
                          {editingUnitId === u.id ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-primary"
                                disabled={!editingUnitName.trim() || updateUnit.isPending}
                                onClick={() => updateUnit.mutate({ id: u.id, name: editingUnitName.trim() })}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingUnitId(null); setEditingUnitName(""); }}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingUnitId(u.id); setEditingUnitName(u.name); }}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => { setPendingUnit(u); setUnitDeleteOpen(true); }}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!unitsLoading && units?.length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">No units added yet.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Departments */}
          <TabsContent value="departments">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4" /> Department Management</CardTitle>
                <Button size="sm" onClick={() => { setEditingDept(null); setDeptName(""); setDeptDialogOpen(true); }}>
                  <PlusCircle className="h-4 w-4 mr-2" /> Add Department
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Department Name</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {departments?.map((d: any) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">{d.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(d.created_at)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={d.is_active !== false}
                              onCheckedChange={(checked) => toggleDeptActive.mutate({ id: d.id, is_active: checked })}
                            />
                            <span className={`text-xs font-medium ${d.is_active !== false ? "text-green-600" : "text-red-600"}`}>
                              {d.is_active !== false ? "Active" : "Inactive"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingDept(d); setDeptName(d.name); setDeptDialogOpen(true); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => { setEditingDept(d); setDeptDeleteOpen(true); }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {departments?.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No departments yet.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* SLA */}
          <TabsContent value="sla">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>SLA Configuration</CardTitle>
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">Enforce SLA</Label>
                    <Switch checked={slaEnabled} onCheckedChange={setSlaEnabled} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {(["critical", "high", "medium", "low"] as const).map((priority) => (
                  <div key={priority} className="border rounded-lg p-4 space-y-3">
                    <h3 className="font-semibold capitalize text-sm">{priority} Priority</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Response Time (hours)</Label>
                        <Input type="number" value={slaConfig[priority].response} onChange={e => setSlaConfig({ ...slaConfig, [priority]: { ...slaConfig[priority], response: Number(e.target.value) } })} />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Resolution Time (hours)</Label>
                        <Input type="number" value={slaConfig[priority].resolution} onChange={e => setSlaConfig({ ...slaConfig, [priority]: { ...slaConfig[priority], resolution: Number(e.target.value) } })} />
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex justify-end">
                  <Button onClick={handleSaveSLA}><Save className="h-4 w-4 mr-2" /> Save SLA Config</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notifications */}
          <TabsContent value="notifications">
            <Card>
              <CardHeader><CardTitle>Notification Preferences</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                {[
                  { label: "Email on new ticket assignment", checked: notifAssignment, onChange: setNotifAssignment },
                  { label: "Notify user on status change", checked: notifStatusChange, onChange: setNotifStatusChange },
                  { label: "SLA breach alerts to admin", checked: notifSlaBreach, onChange: setNotifSlaBreach },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between border rounded-lg p-4">
                    <Label className="font-medium">{item.label}</Label>
                    <Switch checked={item.checked} onCheckedChange={item.onChange} />
                  </div>
                ))}
                <div className="flex justify-end">
                  <Button onClick={handleSaveNotifications}><Save className="h-4 w-4 mr-2" /> Save</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* AI Config */}
          <TabsContent value="ai-config">
            <AIConfigTab />
          </TabsContent>

          {/* Security */}
          <TabsContent value="security">
            <Card>
              <CardHeader><CardTitle>Security Settings</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="border rounded-lg p-4 space-y-3">
                  <Label className="font-medium">Minimum Password Length: {minPasswordLength[0]}</Label>
                  <Slider value={minPasswordLength} onValueChange={setMinPasswordLength} min={6} max={20} step={1} />
                </div>
                <div className="flex items-center justify-between border rounded-lg p-4">
                  <Label className="font-medium">Force password change on first login</Label>
                  <Switch checked={forcePasswordChange} onCheckedChange={setForcePasswordChange} />
                </div>
                <div className="border rounded-lg p-4 space-y-2">
                  <Label className="font-medium">Session Timeout</Label>
                  <Select value={sessionTimeout} onValueChange={setSessionTimeout}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30min">30 minutes</SelectItem>
                      <SelectItem value="1hr">1 hour</SelectItem>
                      <SelectItem value="4hr">4 hours</SelectItem>
                      <SelectItem value="8hr">8 hours</SelectItem>
                      <SelectItem value="never">Never</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end">
                  <Button onClick={handleSaveSecurity}><Save className="h-4 w-4 mr-2" /> Save</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Roles & Permissions (with nested Sheets Sync sub-tab) */}
          <TabsContent value="roles">
            <Tabs defaultValue="permissions" className="space-y-4">
              <TabsList>
                <TabsTrigger value="permissions">Permissions</TabsTrigger>
                <TabsTrigger value="sheets">Sheets Sync</TabsTrigger>
              </TabsList>
              <TabsContent value="permissions">
                <RolesPermissionsTab />
              </TabsContent>
              <TabsContent value="sheets" className="space-y-4">
                <GoogleSheetsSync />
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      </div>

      {/* Department Dialog */}
      <Dialog open={deptDialogOpen} onOpenChange={setDeptDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingDept ? "Edit Department" : "Add Department"}</DialogTitle>
            <DialogDescription>{editingDept ? "Update the department name." : "Enter the new department name."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Department Name</Label>
              <Input value={deptName} onChange={e => setDeptName(e.target.value)} placeholder="e.g. Maintenance" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeptDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => editingDept ? updateDept.mutate({ id: editingDept.id, name: deptName }) : addDept.mutate(deptName)}
              disabled={!deptName.trim()}
            >
              {editingDept ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Department Confirm */}
      <AlertDialog open={deptDeleteOpen} onOpenChange={setDeptDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Department</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{editingDept?.name}</strong>? This may affect existing tickets.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => editingDept && deleteDept.mutate(editingDept.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Unit Dialog */}
      <Dialog open={unitDialogOpen} onOpenChange={setUnitDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Unit</DialogTitle>
            <DialogDescription>Enter the new unit name. It will appear in the ticket form.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Unit Name</Label>
              <Input value={newUnitName} onChange={(e) => setNewUnitName(e.target.value)} placeholder="e.g. Unit D" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnitDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => addUnit.mutate(newUnitName.trim())}
              disabled={!newUnitName.trim() || addUnit.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Unit Confirm */}
      <AlertDialog open={unitDeleteOpen} onOpenChange={setUnitDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Unit</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{pendingUnit?.name}</strong>? It will also be removed from the ticket form.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingUnit && deleteUnit.mutate(pendingUnit.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
