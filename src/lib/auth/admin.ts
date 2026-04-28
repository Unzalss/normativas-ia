import { SupabaseClient, User } from '@supabase/supabase-js';

export interface AdminAuthResult {
  user: User;
  profile: Record<string, unknown>;
}

export class AdminAuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'AdminAuthError';
  }
}

export function getBearerToken(req: Request): string {
  const authHeader = req.headers.get("Authorization");
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AdminAuthError("No authorization token provided or invalid format", 401);
  }

  return authHeader.replace("Bearer ", "");
}

export async function requireAdmin(req: Request, supabase: SupabaseClient): Promise<AdminAuthResult> {
  const token = getBearerToken(req);

  
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  
  if (authError || !user) {
    throw new AdminAuthError("Invalid or expired token", 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    throw new AdminAuthError("User profile not found", 401);
  }

  if (profile.role !== "admin") {
    throw new AdminAuthError("Forbidden: Requires admin privileges", 403);
  }

  return { user, profile };
}
