export function generateId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}
