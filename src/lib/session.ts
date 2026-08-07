import type { ApiMeResponse } from '@/lib/api'
const ENDPOINT = 'https://hq.starbase118.net/api/me'

export async function getProfile(): Promise<ApiMeResponse | null> {
  try {
    const res = await fetch(ENDPOINT, { credentials: 'include', headers: { accept: 'application/json' } })
    if (res.status !== 200) return null
    const body = (await res.json()) as ApiMeResponse
    return body.authenticated ? body : null
  } catch {
    return null
  }
}
