import { createContext, useContext } from "react";
import type { StreakItemType, StreakTokenUse } from "../../api/types";

export interface StreakTokenContextValue {
  uses: StreakTokenUse[];
  /** Spends a token on the given two-day gap. Rejects with the server's error. */
  spend: (itemType: StreakItemType, itemId: number, coveredFrom: string, coveredTo: string) => Promise<void>;
}

export const StreakTokenContext = createContext<StreakTokenContextValue>({
  uses: [],
  spend: () => Promise.reject(new Error("Streak tokens are unavailable here")),
});

export function useStreakTokens(): StreakTokenContextValue {
  return useContext(StreakTokenContext);
}
