export async function loadCommunityAuthorRows(
  supabase: any,
  userIds: string[]
) {
  if (userIds.length === 0) return [];

  const { data, error } = await supabase.rpc("get_community_authors", {
    target_user_ids: userIds,
  });

  if (!error) return data ?? [];

  // Compatibility fallback until the security hardening SQL is applied.
  const [{ data: profilesById }, { data: profilesByUserId }] = await Promise.all([
    supabase.from("profiles").select("*").in("id", userIds),
    supabase.from("profiles").select("*").in("user_id", userIds),
  ]);

  return [...(profilesById ?? []), ...(profilesByUserId ?? [])];
}
