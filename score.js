const RANKS = [
  { name: "Chauffeur de Factures", min: 0 },
  { name: "Runner de Secteur", min: 900 },
  { name: "Fixer B2B", min: 2200 },
  { name: "Closer Néon", min: 4200 },
  { name: "Légende Terrain", min: 7600 }
];

export function totalScore(scores = []) {
  return scores.reduce((sum, row) => sum + Number(row.raw_score || row.score || row.points || 0), 0);
}

export function averageScore(scores = []) {
  const values = scores
    .map((row) => Number(row.raw_score || row.score || row.points || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function todayPercent(scores = [], today) {
  const row = scores.find((item) => item.score_date === today || item.date === today);
  if (!row) return 0;
  const raw = Number(row.raw_score || row.score || row.points || 0);
  const target = Number(row.target_score || row.target || row.objective || 0) || averageScore(scores) || 100;
  return Math.max(0, Math.round((raw / target) * 100));
}

export function scoreClass(percent = 0) {
  if (percent >= 100) return "good";
  if (percent >= 55) return "mid";
  return "low";
}

export function rankFor(total = 0) {
  const currentIndex = Math.max(0, RANKS.findLastIndex((rank) => total >= rank.min));
  const current = RANKS[currentIndex] || RANKS[0];
  const next = RANKS[currentIndex + 1] || null;
  const progress = next
    ? Math.round(((total - current.min) / Math.max(1, next.min - current.min)) * 100)
    : 100;
  return { current, next, progress: Math.min(100, Math.max(0, progress)) };
}

export function streakCount(scores = []) {
  const byDate = new Map(scores.map((row) => [row.score_date || row.date, row]));
  let streak = 0;
  const cursor = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" }));
  for (let i = 0; i < 365; i += 1) {
    const iso = cursor.toLocaleDateString("en-CA");
    const percent = todayPercent([...byDate.values()], iso);
    if (percent < 100) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function streakBlazing(scores = [], today) {
  const percent = todayPercent(scores, today);
  return percent >= 150;
}

export function recentChartDays(scores = [], limit = 8) {
  return [...scores]
    .filter((row) => row.score_date || row.date)
    .sort((a, b) => String(a.score_date || a.date).localeCompare(String(b.score_date || b.date)))
    .slice(-limit);
}
