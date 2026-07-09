// Writing-progress tracking: one snapshot of the project's total word count
// per calendar day, persisted in workspace state. Deltas against the previous
// day and the session baseline drive the status bar and the Progress section.

export interface ProgressSnapshot {
  /** Local calendar date, YYYY-MM-DD */
  date: string;
  /** Total project words at the last analysis of that day */
  words: number;
}

export interface ProgressInfo {
  /** Words added (or removed) today, vs. the last snapshot before today */
  todayDelta: number;
  /** Words added since this editor session's first analysis */
  sessionDelta: number;
  /** Daily goal (0 = disabled) */
  goal: number;
  /** Up to the last 14 days as date + delta, newest first */
  recent: { date: string; words: number; delta: number }[];
  totalWords: number;
}

const MAX_HISTORY = 730;

/** Local calendar date as YYYY-MM-DD. */
export function localDate(d: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Records `words` for `date`, updating today's snapshot in place or appending
 * a new day. Returns the (possibly trimmed) history; entries stay ascending.
 */
export function updateHistory(
  history: ProgressSnapshot[],
  date: string,
  words: number
): ProgressSnapshot[] {
  const out = [...history];
  const last = out[out.length - 1];
  if (last && last.date === date) {
    if (last.words === words) return history;
    out[out.length - 1] = { date, words };
  } else {
    out.push({ date, words });
  }
  return out.length > MAX_HISTORY ? out.slice(out.length - MAX_HISTORY) : out;
}

/**
 * Derives display deltas. `history` must already include today's snapshot
 * (call updateHistory first). `sessionStartWords` is the word count at the
 * session's first analysis.
 */
export function computeProgress(
  history: ProgressSnapshot[],
  today: string,
  sessionStartWords: number,
  goal: number
): ProgressInfo {
  const idx = history.findIndex((h) => h.date === today);
  const current = idx >= 0 ? history[idx].words : history[history.length - 1]?.words ?? 0;
  const prev = idx > 0 ? history[idx - 1].words : idx === 0 ? current : current;
  const recent: ProgressInfo['recent'] = [];
  for (let i = history.length - 1; i > 0 && recent.length < 14; i--) {
    recent.push({
      date: history[i].date,
      words: history[i].words,
      delta: history[i].words - history[i - 1].words,
    });
  }
  return {
    todayDelta: current - prev,
    sessionDelta: current - sessionStartWords,
    goal,
    recent,
    totalWords: current,
  };
}

export function progressToCsv(history: ProgressSnapshot[]): string {
  const lines = ['date,words,delta'];
  for (let i = 0; i < history.length; i++) {
    const delta = i === 0 ? 0 : history[i].words - history[i - 1].words;
    lines.push(`${history[i].date},${history[i].words},${delta}`);
  }
  return lines.join('\n') + '\n';
}

export function progressToJson(history: ProgressSnapshot[]): string {
  return JSON.stringify(
    history.map((h, i) => ({
      ...h,
      delta: i === 0 ? 0 : h.words - history[i - 1].words,
    })),
    null,
    2
  );
}
