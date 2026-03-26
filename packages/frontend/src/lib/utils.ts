import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDate(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const dayMs = 86400000;

  if (diff < dayMs) return "Today";
  if (diff < dayMs * 2) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function platformIcon(platform: string) {
  switch (platform) {
    case "slack":
      return "#";
    case "telegram":
      return "@";
    case "web":
      return ">";
    default:
      return "?";
  }
}
