export type ProfileRecord = {
  is_pro?: boolean | null;
  pro_plan?: string | null;
  pro_expires_at?: string | null;
};

export function isPro(profile?: ProfileRecord | null) {
  if (!profile?.is_pro) return false;
  if (profile.pro_plan === "lifetime") return true;
  if (!profile.pro_expires_at) return true;
  return new Date(profile.pro_expires_at) > new Date();
}
