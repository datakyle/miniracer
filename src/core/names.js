// Player names and crew codes, cleaned the same way in the game and on the
// ghost server.

export function cleanName(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14);
}

// crew codes keep a group's ghosts together: lowercase letters, digits, dashes
export const DEFAULT_CREW = 'public';

export function cleanCrew(raw) {
  const c = String(raw || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return c || DEFAULT_CREW;
}
