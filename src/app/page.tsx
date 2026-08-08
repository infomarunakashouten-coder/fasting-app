import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: profileByNewId, error: profileByNewIdError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  const { data: profileByOldUserId, error: profileByOldUserIdError } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  const profile = profileByNewId ?? profileByOldUserId;
  const profileReadFailed = profileByNewIdError && profileByOldUserIdError;

  if (!profile && !profileReadFailed) {
    redirect("/profile/setup");
  }

  redirect("/dashboard");
}
