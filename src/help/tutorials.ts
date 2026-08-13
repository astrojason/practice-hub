import calendarPracticePlan from "../../docs/tutorials/calendar-practice-plan.md?raw";
import gpLibrary from "../../docs/tutorials/gp-library.md?raw";
import browse from "../../docs/tutorials/browse.md?raw";
import sessionsTimer from "../../docs/tutorials/sessions-timer.md?raw";
import metronome from "../../docs/tutorials/metronome.md?raw";

export interface Tutorial {
  id: string;
  title: string;
  content: string;
}

export const TUTORIALS: Tutorial[] = [
  {
    id: "sessions-timer",
    title: "Sessions & Practice Timer",
    content: sessionsTimer,
  },
  {
    id: "calendar-practice-plan",
    title: "Calendar & Practice Plans",
    content: calendarPracticePlan,
  },
  {
    id: "gp-library",
    title: "GP Library",
    content: gpLibrary,
  },
  {
    id: "browse",
    title: "Browse",
    content: browse,
  },
  {
    id: "metronome",
    title: "Metronome",
    content: metronome,
  },
];
