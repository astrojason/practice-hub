import { API_BASE_URL } from "../config";
import type {
  Artist,
  DashboardData,
  DashboardExercise,
  DashboardStudyMaterial,
  Tuning,
  UpdateExercisePayload,
  UpdateSongPayload,
  UpdateStudyMaterialPayload,
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
  SongSessionListResponse,
  ExerciseSessionListResponse,
  StudyMaterialSessionListResponse,
  PracticeStats,
  CatalogExerciseWithActive,
  PracticePlan,
  PracticePlanWithEntries,
  TodayEntry,
  SongSection,
  CreateSongSectionPayload,
  UpdateSongSectionPayload,
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

// ─── Session history per entity ───────────────────────────────────────────────

export async function getSongSessionHistory(
  token: string,
  songId: number,
  page = 1,
  limit = 50
): Promise<SongSessionListResponse> {
  const params = new URLSearchParams({ song_id: String(songId), page: String(page), limit: String(limit) });
  const response = await fetch(`${API_BASE_URL}/user-song-session?${params}`, {
    headers: authHeaders(token),
  });
  return handleResponse<SongSessionListResponse>(response);
}

export async function getExerciseSessionHistory(
  token: string,
  exerciseId: number,
  page = 1,
  limit = 50
): Promise<ExerciseSessionListResponse> {
  const params = new URLSearchParams({ exercise_id: String(exerciseId), page: String(page), limit: String(limit) });
  const response = await fetch(`${API_BASE_URL}/user-exercise-session?${params}`, {
    headers: authHeaders(token),
  });
  return handleResponse<ExerciseSessionListResponse>(response);
}

export async function getStudyMaterialSessionHistory(
  token: string,
  studyMaterialId: number,
  page = 1,
  limit = 50
): Promise<StudyMaterialSessionListResponse> {
  const params = new URLSearchParams({ study_material_id: String(studyMaterialId), page: String(page), limit: String(limit) });
  const response = await fetch(`${API_BASE_URL}/user-study-material-session?${params}`, {
    headers: authHeaders(token),
  });
  return handleResponse<StudyMaterialSessionListResponse>(response);
}

// ─── Practice stats ───────────────────────────────────────────────────────────

export async function getUserStats(token: string): Promise<PracticeStats> {
  const response = await fetch(`${API_BASE_URL}/user/stats`, {
    headers: authHeaders(token),
  });
  return handleResponse<PracticeStats>(response);
}

// ─── Exercise catalog (historical) ───────────────────────────────────────────

export async function getExerciseCatalog(token: string): Promise<CatalogExerciseWithActive[]> {
  const response = await fetch(`${API_BASE_URL}/exercise/user-catalog`, {
    headers: authHeaders(token),
  });
  return handleResponse<CatalogExerciseWithActive[]>(response);
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

// ─── Guitar Pro difficulty ────────────────────────────────────────────────────

export async function pushDifficultyScore(
  token: string,
  songId: number,
  difficultyScore: number
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/song/${songId}/difficulty`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ difficulty_score: difficultyScore }),
  });
  await handleResponse<unknown>(response);
}

export async function registerGpResource(
  token: string,
  songId: number,
  filePath: string,
  resourceName: string
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/song/${songId}/resource`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({
      name: resourceName,
      url: filePath,
      type: "guitar_pro",
    }),
  });
  await handleResponse<unknown>(response);
}

// ─── Artists / Tunings ───────────────────────────────────────────────────────

export async function getArtists(token: string): Promise<{ artists: Artist[] }> {
  const response = await fetch(`${API_BASE_URL}/artist?all=true`, {
    headers: authHeaders(token),
  });
  return handleResponse<{ artists: Artist[] }>(response);
}

export async function getTunings(token: string): Promise<{ tunings: Tuning[] }> {
  const response = await fetch(`${API_BASE_URL}/tuning?all=true`, {
    headers: authHeaders(token),
  });
  return handleResponse<{ tunings: Tuning[] }>(response);
}

// ─── Entity edit ─────────────────────────────────────────────────────────────

export async function updateSong(
  token: string,
  songId: number,
  payload: UpdateSongPayload
): Promise<Song> {
  const response = await fetch(`${API_BASE_URL}/song/${songId}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  return handleResponse<Song>(response);
}

export async function updateExercise(
  token: string,
  exerciseId: number,
  payload: UpdateExercisePayload
): Promise<DashboardExercise> {
  const response = await fetch(`${API_BASE_URL}/exercise/${exerciseId}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  return handleResponse<DashboardExercise>(response);
}

export async function updateStudyMaterial(
  token: string,
  studyMaterialId: number,
  payload: UpdateStudyMaterialPayload
): Promise<DashboardStudyMaterial> {
  const response = await fetch(`${API_BASE_URL}/study-material/${studyMaterialId}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  return handleResponse<DashboardStudyMaterial>(response);
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

export async function getStudyMaterialById(
  token: string,
  id: number
): Promise<DashboardStudyMaterial> {
  const response = await fetch(`${API_BASE_URL}/study-material/${id}`, {
    headers: authHeaders(token),
  });
  return handleResponse<DashboardStudyMaterial>(response);
}

// ─── Practice plans ───────────────────────────────────────────────────────────

export async function getPracticePlans(token: string): Promise<{ plans: PracticePlan[] }> {
  const response = await fetch(`${API_BASE_URL}/practice-plan`, {
    headers: authHeaders(token),
  });
  return handleResponse<{ plans: PracticePlan[] }>(response);
}

export async function getActivePracticePlan(token: string): Promise<{ plan: PracticePlanWithEntries | null }> {
  const response = await fetch(`${API_BASE_URL}/practice-plan/active`, {
    headers: authHeaders(token),
  });
  return handleResponse<{ plan: PracticePlanWithEntries | null }>(response);
}

export async function getPracticePlan(token: string, id: number): Promise<{ plan: PracticePlanWithEntries }> {
  const response = await fetch(`${API_BASE_URL}/practice-plan/${id}`, {
    headers: authHeaders(token),
  });
  return handleResponse<{ plan: PracticePlanWithEntries }>(response);
}

export async function createPracticePlan(
  token: string,
  data: { name: string; start_date: string; end_date: string }
): Promise<{ plan: PracticePlan }> {
  const response = await fetch(`${API_BASE_URL}/practice-plan`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  return handleResponse<{ plan: PracticePlan }>(response);
}

export async function activatePracticePlan(token: string, id: number): Promise<{ plan: PracticePlan }> {
  const response = await fetch(`${API_BASE_URL}/practice-plan/${id}/activate`, {
    method: "POST",
    headers: authHeaders(token),
  });
  return handleResponse<{ plan: PracticePlan }>(response);
}

export async function getTodaysPracticePlan(token: string): Promise<{ day: number; entries: TodayEntry[] }> {
  const response = await fetch(`${API_BASE_URL}/practice-plan/today`, {
    headers: authHeaders(token),
  });
  return handleResponse<{ day: number; entries: TodayEntry[] }>(response);
}

export async function addPracticePlanEntry(
  token: string,
  planId: number,
  data: { song_section_id: number; day_of_plan: number; block_order: number; block_duration_seconds: number }
): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}/practice-plan/${planId}/entry`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  return handleResponse<unknown>(response);
}

export async function updatePracticePlanEntry(
  token: string,
  entryId: number,
  data: Partial<{ block_order: number; block_duration_seconds: number; day_of_plan: number }>
): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}/practice-plan/entry/${entryId}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  return handleResponse<unknown>(response);
}

export async function deletePracticePlanEntry(token: string, entryId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/practice-plan/entry/${entryId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  await handleResponse<unknown>(response);
}

// ─── Song sections ────────────────────────────────────────────────────────────

export async function createSongSection(
  token: string,
  songId: number,
  payload: CreateSongSectionPayload
): Promise<SongSection> {
  const response = await fetch(`${API_BASE_URL}/song/${songId}/section`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  return handleResponse<SongSection>(response);
}

export async function updateSongSection(
  token: string,
  sectionId: number,
  payload: UpdateSongSectionPayload
): Promise<SongSection> {
  const response = await fetch(`${API_BASE_URL}/song/section/${sectionId}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  return handleResponse<SongSection>(response);
}

export async function deleteSongSection(token: string, sectionId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/song/section/${sectionId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  await handleResponse<unknown>(response);
}
