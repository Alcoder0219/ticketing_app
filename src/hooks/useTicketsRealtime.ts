import { useEffect } from "react";
import { supabase } from "@/integrations/api/client";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Subscribe to changes on the tickets table and invalidate the given React Query keys.
 * Used so aging freezes / lists refresh when a ticket is resolved or closed without a page reload.
 */
export function useTicketsRealtime(queryKeys: (string | (string | undefined)[])[]) {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`tickets-rt-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, () => {
        for (const k of queryKeys) {
          qc.invalidateQueries({ queryKey: Array.isArray(k) ? k : [k] });
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
