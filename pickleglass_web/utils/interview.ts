import { apiCall } from './api';

export interface InterviewProfile {
  id?: string;
  mode?: 'interview' | 'cv_only';
  revision: number;
  name: string;
  company: string;
  role: string;
  level: string;
  minutes: number;
  resume: { name: string; text: string; confirmed: boolean; confirmedHash?: string };
  additionalContext?: string;
  jd: { text: string; url: string };
  references: { name: string; text: string }[];
}
export interface InterviewList { profiles: InterviewProfile[]; selectedId: string | null; active: { name: string; revision: number } | null }
export interface ContextPreview {
  text: string; characters: number; estimatedTokens: number; truncated: boolean; sha256: string;
  packet: { name: string; revision: number; mode?: 'interview' | 'cv_only' };
}
export async function interviewRequest<T>(action: string, ownerId?: string, payload?: unknown): Promise<{ ownerId: string; data: T }> {
  let response: Response;
  try {
    response = await apiCall(action === 'list' ? '/api/interviews' : `/api/interviews/${action}`, {
    method: action === 'list' ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Interview-Client': 'website' },
    cache: 'no-store',
    ...(action === 'list' ? {} : { body: JSON.stringify({ ownerId, payload }) }),
    });
  } catch {
    throw new Error('Glass is not reachable. Open Glass, then open Interview Context from its Settings menu to reconnect. Your saved profile remains on this device.');
  }
  const result = await response.json().catch(() => ({ error: response.status === 404
    ? 'Restart the desktop app to enable Interview Context on this website.'
    : 'Interview request failed. Please retry.' }));
  if (!response.ok) throw Object.assign(new Error(result.error || 'Interview request failed.'), { ownerChanged: result.ownerChanged });
  return result;
}
export async function resumeHash(text: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text.trim()));
  return Array.from(new Uint8Array(bytes)).map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function documentUpload(file: File) {
  if (file.size > 2 * 1024 * 1024) throw new Error('Choose a document smaller than 2 MiB.');
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read the document.'));
    reader.readAsDataURL(file);
  });
  return { name: file.name, base64 };
}
