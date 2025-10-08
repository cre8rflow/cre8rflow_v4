type FontInstance = {
  className: string;
};

const createFont = (className: string): FontInstance => ({ className });

const inter = createFont("font-sans");
const roboto = createFont("font-sans");
const openSans = createFont("font-sans");
const playfairDisplay = createFont("font-serif");
const comicNeue = createFont("font-sans");

export const FONT_CLASS_MAP = {
  Inter: inter.className,
  Roboto: roboto.className,
  "Open Sans": openSans.className,
  "Playfair Display": playfairDisplay.className,
  "Comic Neue": comicNeue.className,
  Arial: "font-sans",
  Helvetica: "font-sans",
  "Times New Roman": "font-serif",
  Georgia: "font-serif",
} as const;

export const fonts = {
  inter,
  roboto,
  openSans,
  playfairDisplay,
  comicNeue,
};

export const defaultFont = inter;
