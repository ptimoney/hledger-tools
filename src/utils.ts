export function escapeRegex(input: string): string {
  // Regex to match special characters in a regex and escape them.
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
