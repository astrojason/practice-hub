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
}

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
  created_timestamp: number;
  updated_timestamp: number;
}

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

export interface ExerciseSession {
  id: number;
  exercise_id: number;
  notes: string | null;
  rating: StudyRating;
  bpm: number | null;
  seconds: number;
  created_timestamp: number;
  updated_timestamp: number;
}

export interface Exercise {
  id: number;
  name: string;
  order: number | null;
  resources: Resource[] | null;
  session_type: "exercise";
  parent_exercise_id: number | null;
  created_timestamp: number;
  updated_timestamp: number;
}

export interface UserExercise {
  id: number;
  exercise_id: number;
  user_id: number;
  randomize_sub_exercises: boolean;
  use_keys: boolean;
  use_scales: boolean;
  exercise: Exercise;
  sessions: ExerciseSession[];
  sub_exercises?: UserExercise[];
}

export interface StudyMaterialSession {
  id: number;
  study_material_id: number;
  user_id: number;
  notes: string | null;
  rating: StudyRating;
  seconds: number;
  created_timestamp: number;
  updated_timestamp: number;
}

export interface StudyMaterial {
  id: number;
  name: string;
  url: string | null;
  instrument: number | null;
  parent_study_material_id: number | null;
  session_type: "study_material";
  created_timestamp: number;
  updated_timestamp: number;
}

export interface UserStudyMaterial {
  id: number;
  study_material_id: number;
  user_id: number;
  study_material: StudyMaterial;
  sessions: StudyMaterialSession[];
}

export interface Scale {
  id: number;
  name: string;
  formula: string;
  tonality: string;
  description: string;
  resources: Resource[];
  created_timestamp?: number;
}

export interface KeySignature {
  id: number;
  name: string;
  sharps: number;
  flats: number;
  notes: string[];
  created_timestamp?: number;
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
  exercises: UserExercise[];
  study_materials: UserStudyMaterial[];
  chord: Chord | null;
  progression: Progression | null;
  interval: Interval | null;
}

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
