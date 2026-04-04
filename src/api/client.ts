import { API_BASE_URL } from "../config";
import type {
  DashboardData,
  UserProfile,
  UserSettings,
  UpdateUserSettingsPayload,
  SongSessionPayload,
  SongSessionResponse,
  ExerciseSessionPayload,
  ExerciseSessionResponse,
  StudyMaterialSessionPayload,
  StudyMaterialSessionResponse,
  OpenSessionPayload,
  OpenSessionResponse,
  Song,
  CatalogSongsResponse,
  CatalogExercisesResponse,
  CatalogStudyMaterialsResponse,
} from "./types";

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json() as Promise<T>;
}

// ─── User ─────────────────────────────────────────────────────────────────────

export async function getUser(token: string): Promise<UserProfile> {
  const response = await fetch(`${API_BASE_URL}/user/me`, {
    headers: authHeaders(token),
  });
  return handleResponse<UserProfile>(response);
}

export async function getUserSettings(token: string): Promise<UserSettings> {
  const response = await fetch(`${API_BASE_URL}/user/settings`, {
    headers: authHeaders(token),
  });
  return handleResponse<UserSettings>(response);
}

export async function updateUserSettings(
  token: string,
  payload: UpdateUserSettingsPayload
): Promise<UserSettings> {
  const response = await fetch(`${API_BASE_URL}/user/settings`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  return handleResponse<UserSettings>(response);
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export async function getDashboard(token: string): Promise<DashboardData> {
  const response = await fetch(`${API_BASE_URL}/user/dashboard`, {
    headers: authHeaders(token),
  });
  return handleResponse<DashboardData>(response);
}

export async function rebuildDashboard(token: string): Promise<DashboardData> {
  const response = await fetch(`${API_BASE_URL}/user/dashboard?refresh=1`, {
    headers: authHeaders(token),
  });
  return handleResponse<DashboardData>(response);
}

// ─── Session logging ──────────────────────────────────────────────────────────

export async function postSongSession(
  token: string,
  payload: SongSessionPayload
): Promise<SongSessionResponse> {
  const response = await fetch(`${API_BASE_URL}/user-song-session`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  return handleResponse<SongSessionResponse>(response);
}

export async function postExerciseSession(
  token: string,
  payload: ExerciseSessionPayload
): Promise<ExerciseSessionResponse> {
  const response = await fetch(`${API_BASE_URL}/user-exercise-session`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  return handleResponse<ExerciseSessionResponse>(response);
}

export async function postStudyMaterialSession(
  token: string,
  payload: StudyMaterialSessionPayload
): Promise<StudyMaterialSessionResponse> {
  const response = await fetch(`${API_BASE_URL}/user-study-material-session`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  return handleResponse<StudyMaterialSessionResponse>(response);
}

export async function postOpenSession(
  token: string,
  payload: OpenSessionPayload
): Promise<OpenSessionResponse> {
  const response = await fetch(`${API_BASE_URL}/user-open-session`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  return handleResponse<OpenSessionResponse>(response);
}

// ─── Quick Add catalog ────────────────────────────────────────────────────────

export async function getOverdueSongs(token: string): Promise<Song[]> {
  const response = await fetch(`${API_BASE_URL}/user-song-list/overdue`, {
    headers: authHeaders(token),
  });
  return handleResponse<Song[]>(response);
}

export async function getCatalogSongs(
  token: string,
  page: number,
  limit: number,
  q?: string
): Promise<CatalogSongsResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (q) params.set("q", q);
  const response = await fetch(`${API_BASE_URL}/song?${params}`, {
    headers: authHeaders(token),
  });
  return handleResponse<CatalogSongsResponse>(response);
}

export async function getCatalogExercises(
  token: string,
  page: number,
  limit: number,
  q?: string
): Promise<CatalogExercisesResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (q) params.set("q", q);
  const response = await fetch(`${API_BASE_URL}/exercise?${params}`, {
    headers: authHeaders(token),
  });
  return handleResponse<CatalogExercisesResponse>(response);
}

export async function getCatalogStudyMaterials(
  token: string,
  page: number,
  limit: number,
  q?: string
): Promise<CatalogStudyMaterialsResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (q) params.set("q", q);
  const response = await fetch(`${API_BASE_URL}/study-material?${params}`, {
    headers: authHeaders(token),
  });
  return handleResponse<CatalogStudyMaterialsResponse>(response);
}
