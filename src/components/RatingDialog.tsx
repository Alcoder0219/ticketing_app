import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticketId: string;
  ticketNumber: string;
  onSubmitted?: () => void;
}

export function RatingDialog({ open, onOpenChange, ticketId, ticketNumber, onSubmitted }: Props) {
  const { user } = useAuth();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => { setRating(0); setHover(0); setComment(""); };

  const handleSubmit = async () => {
    if (!rating || !user) {
      toast.error("Please select a rating");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("ticket_ratings").insert({
      ticket_id: ticketId,
      rated_by: user.id,
      rating,
      feedback: comment.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message || "Failed to submit rating");
      return;
    }
    toast.success("Thank you for your rating!");
    onSubmitted?.();
    onOpenChange(false);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="text-xs font-mono text-muted-foreground">#{ticketNumber}</div>
          <DialogTitle>Rate your experience</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-center gap-1 py-2">
          {[1, 2, 3, 4, 5].map((n) => {
            const active = (hover || rating) >= n;
            return (
              <button
                key={n}
                type="button"
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                onClick={() => setRating(n)}
                className="p-1 transition-transform hover:scale-110"
                aria-label={`${n} star${n > 1 ? "s" : ""}`}
              >
                <Star className={cn("h-8 w-8", active ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
              </button>
            );
          })}
        </div>
        <Textarea
          placeholder="Share your feedback..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
        />
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || !rating} className="bg-blue-600 hover:bg-blue-700 text-white">
            {submitting ? "Submitting..." : "Submit Rating"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
