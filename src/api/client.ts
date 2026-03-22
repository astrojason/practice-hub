import { API_BASE_URL } from "../config";
import type {
  DashboardData,
  UserSettings,
  UpdateUserSettingsPayload,
} from "./types";

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json() as Promise<T>;
}

export async function getDashboard(token: string): Promise<DashboardData> {
  const response = await fetch(`${API_BASE_URL}/user/dashboard`, {
    headers: authHeaders(token),
  });
  return handleResponse<DashboardData>(response);
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
