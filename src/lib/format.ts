const NO_COLOR = !!process.env.NO_COLOR;

function color(code: string, text: string): string {
  if (NO_COLOR) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

export const bold = (s: string) => color("1", s);
export const dim = (s: string) => color("2", s);
export const red = (s: string) => color("31", s);
export const green = (s: string) => color("32", s);
export const yellow = (s: string) => color("33", s);
export const blue = (s: string) => color("34", s);
export const cyan = (s: string) => color("36", s);

export function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

export function padLeft(s: string, len: number): string {
  return s.length >= len ? s : " ".repeat(len - s) + s;
}

export function formatStatus(status: string): string {
  switch (status) {
    case "done":
      return green("done");
    case "in-progress":
      return yellow("in-progress");
    case "blocked":
      return red("blocked");
    case "cancelled":
      return dim("cancelled");
    default:
      return status;
  }
}

export function formatPriority(priority: string): string {
  switch (priority) {
    case "p0":
      return red("p0");
    case "p1":
      return yellow("p1");
    case "p2":
      return dim("p2");
    default:
      return priority;
  }
}
