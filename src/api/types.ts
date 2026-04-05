// ─── Shared primitives ────────────────────────────────────────────────────────

export type StudyRating = "Awful" | "Bad" | "Neutral" | "Good" | "Great";
export type StudyFocus =
  | "Control"
  | "Clarity"
  | "Consistency"
  | "Musicality"
  | "Playthrough";

export interface Resource {
  name: string;
  url: string;
  type?: "url" | "local_file" | "youtube" | "guitar_pro";
}

// ─── Session records (as returned by POST and inside meta.sessions) ───────────

export interface SongSession {
  id: number;
  song_id: number;
  user_id: number;
  focus: StudyFocus | null;
  bpm: number | null;
  rating: StudyRating | null;
  seconds: number;
  notes: string | null;
  from_memory: boolean;
  rhythm: boolean;
  lead: boolean;
  singing: boolean;
  created_timestamp: number;
  updated_timestamp: number;
}

export interface ExerciseSession {
  id: number;
  exercise_id: number;
  notes: string | null;
  rating: StudyRating | null;
  bpm: number | null;
  seconds: number;
  created_timestamp: number;
  updated_timestamp: number;
}

export interface StudyMaterialSession {
  id: number;
  study_material_id: number;
  user_id: number;
  notes: string | null;
  rating: StudyRating | null;
  seconds: number;
  created_timestamp: number;
  updated_timestamp: number;
}

export interface OpenSession {
  id: number;
  user_id: number;
  rating: StudyRating | null;
  seconds: number;
  notes: string | null;
  created_timestamp: number;
  updated_timestamp: number;
}

// ─── Song ─────────────────────────────────────────────────────────────────────

export interface SongMeta {
  id?: number;
  user_id?: number;
  song_id?: number;
  date_learned: number | null;
  difficulty: number | null;
  difficulty_name: string | null;
  song_lists?: SongListRef[];
  sessions?: SongSession[];
}

export interface SongListRef {
  id: number;
  type: number;
  name: string;
}

export interface Song {
  id: number;
  name: string;
  artist_id: number;
  artist_name: string;
  tuning_id: number;
  tuning_name: string;
  bpm: number | null;
  active: boolean;
  resources: Resource[] | null;
  tags: string[];
  seconds: number | null;
  session_type: "song";
  created_timestamp: number;
  updated_timestamp: number;
  meta: SongMeta;
}

export interface SongList {
  id: number;
  user_id: number;
  name: string;
  type: number;
  session_playlist: boolean;
  created_timestamp: number;
  updated_timestamp: number;
  songs: Song[];
}

// ─── Exercise (dashboard shape) ───────────────────────────────────────────────

export interface UserExerciseMeta {
  id: number;
  exercise_id: number;
  user_id: number;
  randomize_sub_exercises: boolean;
  use_keys: boolean;
  use_scales: boolean;
}

export interface DashboardExercise {
  id: number;
  name: string;
  order: number | null;
  resources: Resource[] | null;
  session_type: "exercise";
  parent_exercise_id: number | null;
  created_timestamp: number;
  updated_timestamp: number;
  child_exercises: DashboardExercise[];
  meta: {
    user_exercise: UserExerciseMeta | null;
    sessions: ExerciseSession[];
  };
}

// ─── Study material (dashboard shape) ─────────────────────────────────────────

export interface DashboardStudyMaterial {
  id: number;
  name: string;
  url: string | null;
  instrument: number | null;
  parent_study_material_id: number | null;
  session_type: "study_material";
  created_timestamp: number;
  updated_timestamp: number;
  child_study_materials?: DashboardStudyMaterial[];
  meta: {
    user_study_material: { user_id: number; study_material_id: number } | null;
    sessions: StudyMaterialSession[];
  };
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface Scale {
  id: number;
  name: string;
  formula: string;
  tonality: string;
  description: string;
  resources: Resource[];
}

export interface KeySignature {
  id: number;
  name: string;
  sharps: number;
  flats: number;
  notes: string[];
}

export interface Chord {
  id: number;
  name: string;
  formula: string;
  resources: Resource[];
}

export interface Progression {
  id: number;
  name: string;
  chords: string[];
}

export interface Interval {
  id: number;
  name: string;
  short_name: string;
  semitones: number;
  quality: string;
  hint: string;
}

export interface DashboardData {
  scale: Scale | null;
  key_signature: KeySignature | null;
  overdue: Song[];
  to_review: SongList;
  to_learn: SongList;
  project: SongList;
  exercises: DashboardExercise[];
  study_materials: DashboardStudyMaterial[];
  chord: Chord | null;
  progression: Progression | null;
  interval: Interval | null;
}

// ─── User profile (GET /user/me) ──────────────────────────────────────────────

export interface UserProfile {
  id: number;
  firebase_uid: string;
  email: string;
  display_name: string;
  daily_minutes_goal: number;
  timezone: string;
  time_practiced_today: number;
  total_time_practiced: number;
  max_days_no_review: number;
  min_days_between_reviews: number;
  num_songs_to_learn: number;
}

// ─── User settings (GET/PUT /user/settings) ───────────────────────────────────

export interface UserSettings {
  id: number;
  firebase_uid: string;
  uid: string;
  email: string;
  name: string | null;
  picture: string | null;
  created_timestamp: number;
  updated_timestamp: number;
  max_days_no_review: number;
  min_days_between_reviews: number;
  num_songs_to_learn: number;
  primary_instrument: number | null;
  days_scale_study: number;
  total_time_practiced: number;
  daily_minutes_goal: number;
  is_admin: boolean;
  timezone: string;
  time_practiced_today?: number;
}

export interface UpdateUserSettingsPayload {
  num_songs_to_learn?: number;
  max_days_no_review?: number;
  min_days_between_reviews?: number;
  daily_minutes_goal?: number;
  days_scale_study?: number;
}

// ─── Session POST payloads ────────────────────────────────────────────────────

export interface SongSessionPayload {
  song_id: number;
  seconds: number;
  focus: number | null; // 1=Control 2=Clarity 3=Consistency 4=Musicality 5=Playthrough
  bpm: number | null;
  rating: number | null; // 1=Awful 2=Bad 3=Neutral 4=Good 5=Great
  notes: string | null;
  from_memory: boolean;
  rhythm: boolean;
  lead: boolean;
  singing: boolean;
}

export interface ExerciseSessionPayload {
  exercise_id: number;
  seconds: number;
  bpm: number | null;
  rating: number | null;
  notes: string | null;
}

export interface StudyMaterialSessionPayload {
  study_material_id: number;
  seconds: number;
  rating: number | null;
  notes: string | null;
}

export interface OpenSessionPayload {
  seconds: number;
  rating: number | null;
  notes: string | null;
}

// ─── Session POST responses ───────────────────────────────────────────────────

// All session POST responses include daily_practice_time
export interface SessionPostResponse {
  id: number;
  daily_practice_time: number; // total seconds practiced today (all types)
  update_log: string;
}

export interface SongSessionResponse extends SessionPostResponse {
  song_id: number;
  user_id: number;
  focus: StudyFocus | null;
  bpm: number | null;
  rating: StudyRating | null;
  seconds: number;
  notes: string | null;
  from_memory: boolean;
  rhythm: boolean;
  lead: boolean;
  singing: boolean;
  created_timestamp: number;
  updated_timestamp: number;
}

export interface ExerciseSessionResponse extends SessionPostResponse {
  exercise_id: number;
  bpm: number | null;
  rating: StudyRating | null;
  seconds: number;
  notes: string | null;
  created_timestamp: number;
  updated_timestamp: number;
}

export interface StudyMaterialSessionResponse extends SessionPostResponse {
  study_material_id: number;
  rating: StudyRating | null;
  seconds: number;
  notes: string | null;
  created_timestamp: number;
  updated_timestamp: number;
}

export interface OpenSessionResponse extends SessionPostResponse {
  rating: StudyRating | null;
  seconds: number;
  notes: string | null;
  created_timestamp: number;
  updated_timestamp: number;
}

// ─── Session history list responses (GET with entity filter) ─────────────────

export interface SongSessionListResponse {
  user_song_sessions: SongSession[];
  total: number;
  page: number;
  limit: number;
}

export interface ExerciseSessionListResponse {
  user_exercise_sessions: ExerciseSession[];
  total: number;
  page: number;
  limit: number;
}

export interface StudyMaterialSessionListResponse {
  user_study_material_sessions: StudyMaterialSession[];
  total: number;
  page: number;
  limit: number;
}

// ─── Practice stats (GET /user/stats) ────────────────────────────────────────

export interface DailyChartPoint {
  date: string; // ISO date "YYYY-MM-DD"
  totalSeconds: number;
}

export interface MonthlyChartPoint {
  month: string; // "Jan", "Feb", etc.
  totalSeconds: number;
  year: number;
  monthNumber: number;
}

export interface YearlyChartPoint {
  year: number;
  totalSeconds: number;
}

export interface PracticeStatsTotals {
  daily: number;
  monthly: number;
  yearly: number;
  lifetime: number;
}

export interface PracticeStatsTotalsByType {
  songs: number;
  exercises: number;
  studyMaterials: number;
  openSessions: number;
}

export interface PracticeStatsHighlight {
  mostPracticedSong: { id: number; name: string; totalSeconds: number } | null;
  longestPracticeDay: { date: string; totalSeconds: number } | null;
  longestStreakDays: number;
  longestNonZeroStreak: number;
  firstPracticeSession: { date: string; entityType: string; name: string } | null;
  longestEntityStreaks: { songs: number; exercises: number; studyMaterials: number };
}

export interface PracticeStats {
  chart: {
    daily: DailyChartPoint[];
    monthly: MonthlyChartPoint[];
    yearly: YearlyChartPoint[];
  };
  totals: PracticeStatsTotals;
  totalsByType: PracticeStatsTotalsByType;
  rangeTotals: Record<string, number>;
  highlights: PracticeStatsHighlight;
  rangeHighlights: Record<string, PracticeStatsHighlight>;
  rangeLabels: Record<string, string>;
  rangeItems: Record<string, { songs: { id: number; name: string; totalSeconds: number }[]; exercises: { id: number; name: string; totalSeconds: number }[]; studyMaterials: { id: number; name: string; totalSeconds: number }[] }>;
  userJoinedTimestamp: number | null;
}

// ─── Exercise catalog (GET /exercise/user-catalog) ────────────────────────────

export interface CatalogExerciseWithActive {
  id: number;
  name: string;
  order: number | null;
  parent_exercise_id: number | null;
  active: boolean;
}

// ─── Catalog fetch types (Quick Add) ─────────────────────────────────────────

export interface CatalogSongsResponse {
  songs: Song[];
  total: number;
  page: number;
  limit: number;
}

export interface CatalogExercise {
  id: number;
  name: string;
  order: number | null;
  resources: Resource[] | null;
  parent_exercise_id: number | null;
  child_exercises: CatalogExercise[];
}

export interface CatalogExercisesResponse {
  exercises: CatalogExercise[];
  total: number;
  page: number;
  limit: number;
}

export interface CatalogStudyMaterial {
  id: number;
  name: string;
  url: string | null;
  instrument: number | null;
  parent_study_material_id: number | null;
  child_study_materials?: CatalogStudyMaterial[];
}

export interface CatalogStudyMaterialsResponse {
  study_material: CatalogStudyMaterial[];
  total: number;
  page: number;
  limit: number;
}
