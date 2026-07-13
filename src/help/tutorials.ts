import calendarPracticePlan from "../../docs/tutorials/calendar-practice-plan.md?raw";

export interface Tutorial {
  id: string;
  title: string;
  content: string;
}

export const TUTORIALS: Tutorial[] = [
  {
    id: "calendar-practice-plan",
    title: "Calendar & Practice Plans",
    content: calendarPracticePlan,
  },
];
