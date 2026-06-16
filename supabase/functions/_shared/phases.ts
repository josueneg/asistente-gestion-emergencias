export const PHASES = [
  "Prevención",
  "Mitigación",
  "Preparación",
  "Desastre",
  "Respuesta",
  "Rehabilitación",
  "Recuperación",
  "Otro",
] as const;

export type Phase = (typeof PHASES)[number];

export function isValidPhase(value: string): value is Phase {
  return (PHASES as readonly string[]).includes(value);
}
