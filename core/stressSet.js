// @ts-check
/**
 * @module core/stressSet
 * Part 15 Stress Dataset for validating card robustness across layout edges.
 *
 * Edge cases covered:
 * 1. Very short name (2 characters)
 * 2. Normal typical name
 * 3. 57-character long name
 * 4. Single 28-letter word without spaces
 * 5. Accents and ampersand (& and XML entities)
 * 6. Long organization and role text
 * 7. Missing photo (photo: null)
 * 8. Empty optional fields
 */

/** Very short name */
export const stressPersonShortName = {
  id: "HX26-S-001",
  name: "Al",
  roleId: "participant",
  org: "ACM",
  email: "al@example.com",
  photo: "assets/photos/person.jpg",
  flags: [],
};

/** Normal typical participant */
export const stressPersonNormal = {
  id: "HX26-S-002",
  name: "Preet Patel",
  roleId: "participant",
  org: "ACM NIT Surat",
  email: "preet@example.com",
  photo: "assets/photos/person.jpg",
  flags: [],
};

/** 57-character name */
export const stressPersonLong57 = {
  id: "HX26-S-003",
  name: "Dr. Rajeshwari Venkatanarasimharajuvaripeta-Krishnamurthy",
  roleId: "participant",
  org: "ACM NIT Surat",
  email: "rajeshwari@example.com",
  photo: "assets/photos/person.jpg",
  flags: ["LONG_NAME"],
};

/** Single 28-letter word */
export const stressPersonSingleWord28 = {
  id: "HX26-S-004",
  name: "Llanfairpwllgwyngyllgogerych",
  roleId: "participant",
  org: "ACM NIT Surat",
  email: "llanfair@example.com",
  photo: "assets/photos/person.jpg",
  flags: ["LONG_NAME"],
};

/** Accents, ampersand and XML characters */
export const stressPersonAccentsAmp = {
  id: "HX26-S-005",
  name: "René Peña & Team <Dev>",
  roleId: "participant",
  org: "ACM R&D Chapter",
  email: "rene@example.com",
  photo: "assets/photos/person.jpg",
  flags: [],
};

/** Long organization and role text */
export const stressPersonLongOrgRole = {
  id: "HX26-S-006",
  name: "Patel Kumar",
  roleId: "organizer",
  org: "Sardar Vallabhbhai National Institute of Technology, Surat",
  email: "patel@example.com",
  photo: "assets/photos/person.jpg",
  flags: [],
};

/** Missing photo */
export const stressPersonNoPhoto = {
  id: "HX26-S-007",
  name: "Aarav Sharma",
  roleId: "participant",
  org: "ACM NIT Surat",
  email: "aarav@example.com",
  photo: null,
  flags: ["NO_PHOTO"],
};

/** Empty optional fields */
export const stressPersonEmptyOptional = {
  id: "HX26-S-008",
  name: "Pat Doe",
  roleId: "participant",
  photo: null,
  flags: [],
};

/** Complete stress dataset array */
export const stressSet = [
  stressPersonShortName,
  stressPersonNormal,
  stressPersonLong57,
  stressPersonSingleWord28,
  stressPersonAccentsAmp,
  stressPersonLongOrgRole,
  stressPersonNoPhoto,
  stressPersonEmptyOptional,
];
