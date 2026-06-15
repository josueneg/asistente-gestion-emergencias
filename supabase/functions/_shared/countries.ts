// Lista de países válidos para "country_origin" / "country_applicable".
// Debe mantenerse igual a shared/countries.js (frontend).
export const VALID_COUNTRIES = [
  "Panamá",
  "Costa Rica",
  "Nicaragua",
  "Honduras",
  "El Salvador",
  "Guatemala",
  "Belice",
  "México",
  "Colombia",
  "Venezuela",
  "Ecuador",
  "Perú",
  "Bolivia",
  "Chile",
  "Argentina",
  "Paraguay",
  "Uruguay",
  "Brasil",
  "República Dominicana",
  "Cuba",
  "España",
  "Estados Unidos",
  "Internacional / organismo multilateral",
];

export function isValidCountry(value: string): boolean {
  return VALID_COUNTRIES.includes(value);
}
