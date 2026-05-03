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

// Seuils en pourcentage entier (cohérents avec l'affichage)
const STREAK_PCT = 100;   // jour validé : pct affiché >= 100%
const BLAZING_PCT = 150;  // jour exceptionnel : pct affiché >= 150%

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

// Streak = nombre de jours CONSECUTIFS (parmi les jours qui ont une ligne en base)
// validés à >= 100% de la moyenne, en partant du plus récent.
// Les jours sans ligne (dimanche off, férié off, journée non travaillée)
// n'apparaissent pas dans la liste donc ne cassent pas la série.
// IMPORTANT : on compare le pourcentage ARRONDI (comme l'affichage), pas le
// ratio brut, pour éviter qu'un jour affiché "100%" soit en réalité refusé
// à cause de l'arrondi flottant.
export function streakCount(days) {
  const avg = averageScore(days);
  if (!avg) return 0;
  const sorted = [...days]
    .filter((day) => day && day.score_date)
    .sort((a, b) => (a.score_date < b.score_date ? 1 : -1));
  let streak = 0;
  for (const day of sorted) {
    const percent = Math.round((Number(day.raw_score || 0) / avg) * 100);
    if (percent >= STREAK_PCT) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

// Blazing = la perf D'AUJOURD'HUI atteint 150%+ de la moyenne (arrondi).
// L'effet disparaît automatiquement le lendemain sauf nouveau 150%+.
export function streakBlazing(days, todayIso) {
  const avg = averageScore(days);
  if (!avg) return false;
  const today = days.find((day) => day.score_date === todayIso);
  if (!today) return false;
  const percent = Math.round((Number(today.raw_score || 0) / avg) * 100);
  return percent >= BLAZING_PCT;
}

export function scoreClass(percent) {
  if (percent >= 120) return "good";
  if (percent >= 80) return "mid";
  return "low";
}

// Renvoie uniquement les jours qui ont une ligne en base, triés chrono asc,
// limités aux N derniers. Pas de placeholder pour les jours non travaillés :
// les sauts (lundi -> jeudi par ex.) sont assumés visuellement.
export function recentChartDays(days, limit = 14) {
  return [...days]
    .filter((day) => day && day.score_date)
    .sort((a, b) => (a.score_date < b.score_date ? -1 : 1))
    .slice(-limit);
}
