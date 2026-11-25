/**
 * Default GM directory (New Orleans sample), the default value of the "directory" world setting.
 * One line per NPC or place: "Name | number", then optional flags: "| public" (players find it by name),
 * "| pin" (favorite sender in Send), "| off" (out of service).
 * "# Title" starts a section. Numbers 555-02xx are reserved for this list (never drawn at random).
 * A world whose directory the GM has edited keeps its own; the others show this list.
 */
export const DIRECTORY_SAMPLE = `Thomas Anderson | 555-0209 | pin
3rd St. phone booth | 555-0211

# Public
Emergency services | 911 | public | pin
Gino's Pizza | 555-0202 | public
City Taxi | 555-0203 | public
General Hospital | 555-0205 | public
Police (front desk) | 555-0206 | public
Lafitte Motel | 555-0200 | public

# Others
`;
