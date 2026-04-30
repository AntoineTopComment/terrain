export const RANKS = [
  { points: 0, name: "Le Gars Qui Essaie" },
  { points: 100, name: "Apprenti Frappeur de Portes" },
  { points: 280, name: "Prospecteur de Zone" },
  { points: 500, name: "Le Loup de Vénissieux" },
  { points: 800, name: "Chauffeur de Factures" },
  { points: 1200, name: "Fermeur de Pipeline" },
  { points: 1800, name: "Architecte de Portefeuille" },
  { points: 2500, name: "Seigneur des kVA" },
  { points: 3500, name: "Le Faiseur de Contrats" },
  { points: 5000, name: "Fantôme des Zones Industrielles" },
  { points: 8000, name: "Légende du Terrain" }
];

export function averageScore(days) {
  if (!days.length) return 0;
  return days.reduce((sum, day) => sum + Number(day.raw_score || 0), 0) / days.length;
}

export function todayPercent(days, todayIso) {
  const avg = averageScore(days);
  const today = days.find((day) => day.score_date === todayIso);
  if (!avg || !today) return 0;
  return Math.round((Number(today.raw_score || 0) / avg) * 100);
}

export function totalScore(days) {
  return days.reduce((sum, day) => sum + Number(day.raw_score || 0), 0);
}

export function rankFor(total) {
  let current = RANKS[0];
  let next = null;
  for (let i = 0; i < RANKS.length; i += 1) {
    if (total >= RANKS[i].points) {
      current = RANKS[i];
      next = RANKS[i + 1] || null;
    }
  }
  const span = next ? next.points - current.points : 1;
  const gained = Math.max(0, total - current.points);
  const progress = next ? Math.min(100, Math.round((gained / span) * 100)) : 100;
  return { current, next, progress };
}

export function streakCount(days) {
  const byDate = new Map(days.map((day) => [day.score_date, Number(day.raw_score || 0)]));
  const avg = averageScore(days);
  if (!avg) return 0;
  const cursor = new Date();
  let streak = 0;
  while (streak < 365) {
    const iso = cursor.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
    const score = byDate.get(iso);
    if (!score || score < avg * 0.8) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function scoreClass(percent) {
  if (percent >= 120) return "good";
  if (percent >= 80) return "mid";
  return "low";
}
