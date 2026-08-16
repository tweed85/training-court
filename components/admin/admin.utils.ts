import { User } from "@supabase/supabase-js";
import { bunnyUserId } from "../premium/premium.utils";

export function isUserAnAdmin(userId: string | null | undefined) {
  const admins = [
    '01a36333-aa26-47e1-bec6-bbdd596a7020',
    '830cc5da-0dc2-44cf-a2b4-676090922637',
    bunnyUserId,
    // dev@local on this instance's Supabase project. The ids above belong to the
    // upstream project and match nobody here, so without this the premium-gated
    // surfaces (match analysis, admin, matchup stats) are unreachable.
    '52168970-2a2a-4a11-89c3-d68960b8ca0e',
  ];

  if (!userId) return false;
  return admins.includes(userId);
}