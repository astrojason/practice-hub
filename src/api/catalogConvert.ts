import type {
  CatalogExercise,
  CatalogStudyMaterial,
  DashboardExercise,
  DashboardStudyMaterial,
} from "./types";

export function catalogExerciseToDashboard(ex: CatalogExercise): DashboardExercise {
  return {
    id: ex.id,
    name: ex.name,
    order: ex.order,
    resources: ex.resources,
    session_type: "exercise",
    parent_exercise_id: ex.parent_exercise_id,
    created_timestamp: 0,
    updated_timestamp: 0,
    child_exercises: ex.child_exercises.map(catalogExerciseToDashboard),
    meta: { user_exercise: null, sessions: [] },
  };
}

export function catalogStudyMaterialToDashboard(sm: CatalogStudyMaterial): DashboardStudyMaterial {
  return {
    id: sm.id,
    name: sm.name,
    url: sm.url,
    type: sm.type,
    instrument: sm.instrument,
    parent_study_material_id: sm.parent_study_material_id,
    session_type: "study_material",
    created_timestamp: 0,
    updated_timestamp: 0,
    child_study_materials: (sm.child_study_materials ?? []).map(catalogStudyMaterialToDashboard),
    meta: { user_study_material: null, sessions: [] },
  };
}
