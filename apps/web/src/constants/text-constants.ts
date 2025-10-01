import { TextElement } from "@/types/timeline";
import { TIMELINE_CONSTANTS } from "./timeline-constants";

export const DEFAULT_TEXT_ELEMENT: Omit<TextElement, "id"> = {
  type: "text",
  name: "Text",
  content: "Default Text",
  fontSize: 48,
  fontFamily: "Arial",
  color: "#ffffff",
  // Use a solid, high-contrast background by default for better readability
  backgroundColor: "#16a34a", // emerald-600
  textAlign: "center",
  fontWeight: "normal",
  fontStyle: "normal",
  textDecoration: "none",
  x: 0,
  y: 0,
  rotation: 0,
  opacity: 1,
  duration: TIMELINE_CONSTANTS.DEFAULT_TEXT_DURATION,
  startTime: 0,
  trimStart: 0,
  trimEnd: 0,
};
