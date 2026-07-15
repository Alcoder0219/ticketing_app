import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

/**
 * Super-admin only ticket delete. Performs cascade cleanup of dependent rows
 * (history, messages, work logs, ratings, attachments, notifications) since
 * the schema has no FK ON DELETE CASCADE. Optimistically removes the ticket
 * from any cached `tickets` lists.
 */
export function useDeleteTicket() {
  const { role } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isSuperAdmin = role === "super_admin";

  const mutation = useMutation({
    mutationFn: async (ticketId: string) => {
      if (!isSuperAdmin) throw new Error("Only Super Admins can delete tickets.");

      // Best-effort cleanup of dependent rows (RLS may block some — ignore errors)
      await Promise.allSettled([
        supabase.from("ticket_history").delete().eq("ticket_id", ticketId),
        supabase.from("ticket_messages").delete().eq("ticket_id", ticketId),
        supabase.from("ticket_work_logs").delete().eq("ticket_id", ticketId),
        supabase.from("ticket_ratings").delete().eq("ticket_id", ticketId),
        supabase.from("ticket_attachments").delete().eq("ticket_id", ticketId),
        supabase.from("notifications").delete().eq("ticket_id", ticketId),
      ]);

      const { error } = await supabase.from("tickets").delete().eq("id", ticketId);
      if (error) throw error;
      return ticketId;
    },
    onMutate: async (ticketId: string) => {
      // Snapshot + optimistic removal across all ticket-list query caches.
      const snapshots: Array<[readonly unknown[], unknown]> = [];
      const queries = queryClient.getQueriesData<any[]>({ predicate: (q) => {
        const k = q.queryKey?.[0];
        return typeof k === "string" && (
          k === "my-tickets" || k === "pending-tickets" ||
          k === "assigned-tickets" || k === "dept-tickets"
        );
      }});
      for (const [key, data] of queries) {
        snapshots.push([key, data]);
        if (Array.isArray(data)) {
          queryClient.setQueryData(key, data.filter((t: any) => t?.id !== ticketId));
        }
      }
      return { snapshots };
    },
    onError: (err: Error, _id, context) => {
      // Rollback
      context?.snapshots?.forEach(([key, data]) => queryClient.setQueryData(key, data));
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
    onSuccess: () => {
      toast({ title: "Ticket deleted permanently" });
    },
  });

  const deleteTicket = (ticketId: string) => {
    if (!isSuperAdmin) return;
    const confirmed = window.confirm(
      "Permanently delete this ticket? This action cannot be undone."
    );
    if (!confirmed) return;
    mutation.mutate(ticketId);
  };

  return { isSuperAdmin, deleteTicket, isDeleting: mutation.isPending };
}
