export interface GithubProfile {
  githubId: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export async function upsertUser(
  fetchFn: typeof fetch,
  cfg: { base: string; secret: string },
  profile: GithubProfile,
): Promise<string> {
  const res = await fetchFn(`${cfg.base}/internal/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Internal-Key': cfg.secret },
    body: JSON.stringify(profile),
  });
  if (!res.ok) throw new Error(`user upsert failed: ${res.status}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}
