import { apiFetch } from "./api";

export type Me = {
  username: string;
  role: "admin" | "reseller";
  reseller_id: number;
  balance: number;
  status: string;
};

export async function fetchMe(): Promise<Me> {
  return apiFetch<Me>("/api/v1/auth/me");
}
