export function rawScore(row = {}) {
  return Number(row.raw_score || row.score || row.points || 0);
}

export function totalScore(scores = []) {
  return scores.reduce((sum, row) => sum + rawScore(row), 0);
}

export function averageScore(scores = []) {
  const values = scores
    .map((row) => rawScore(row))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function todayPercent(scores = [], today) {
  const todayRow = scores.find((item) => item.score_date === today || item.date === today);
  if (!todayRow || !scores.length) return 0;
  const total = scores.reduce((sum, row) => sum + rawScore(row), 0);
  const avg = total / scores.length;
  if (!avg) return 0;
  return Math.max(0, Math.round((rawScore(todayRow) / avg) * 100));
}

export function todaySalesCount(scores = [], today) {
  const todayRow = scores.find((item) => item.score_date === today || item.date === today);
  return Math.max(0, Number(todayRow?.sales_count || 0));
}

export function scoreClass(percent = 0) {
  if (percent >= 100) return "good";
  if (percent >= 55) return "mid";
  return "low";
}

export function normalizeRanks(ranks = []) {
  return [...ranks]
    .map((rank, index) => ({
      level: Number(rank.level ?? index + 1),
      name: String(rank.name || "Rang terrain"),
      points_required: Number(rank.points_required ?? rank.min ?? 0)
    }))
    .filter((rank) => Number.isFinite(rank.level) && Number.isFinite(rank.points_required))
    .sort((a, b) => a.points_required - b.points_required);
}

export function rankFor(total = 0, ranks = []) {
  const ordered = normalizeRanks(ranks);
  if (!ordered.length) return { current: null, next: null, progress: 0 };
  let current = ordered[0];
  let next = ordered[1] || null;
  for (let i = 0; i < ordered.length; i += 1) {
    if (total >= ordered[i].points_required) {
      current = ordered[i];
      next = ordered[i + 1] || null;
    }
  }
  const span = next ? next.points_required - current.points_required : 1;
  const gained = Math.max(0, total - current.points_required);
  const progress = next ? Math.min(100, Math.round((gained / Math.max(1, span)) * 100)) : 100;
  return { current, next, progress: Math.max(0, progress) };
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
