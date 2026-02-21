export const storage = {
  get: (k: string) => (typeof window === "undefined" ? null : window.localStorage.getItem(k)),
  set: (k: string, v: string) => {
    if (typeof window !== "undefined") window.localStorage.setItem(k, v);
  },
  del: (k: string) => {
    if (typeof window !== "undefined") window.localStorage.removeItem(k);
  },
};
