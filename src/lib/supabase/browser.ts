import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | undefined;

export function getSupabaseBrowserClient() {
  client ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
  return client;
}

export async function getAnonymousAccessToken() {
  const supabase = getSupabaseBrowserClient();
  const { data: existing } = await supabase.auth.getSession();
  if (existing.session) return existing.session.access_token;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.session) throw new Error(error?.message ?? "Could not start a player session.");
  return data.session.access_token;
}
