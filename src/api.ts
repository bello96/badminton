/// <reference types="vite/client" />
const API_BASE = import.meta.env.VITE_API_BASE as string | undefined;

export function getHttpBase(): string {
  if (API_BASE) {
    return API_BASE;
  }
  return window.location.origin;
}

export function getWsBase(): string {
  const http = getHttpBase();
  return http.replace(/^http/, "ws");
}
