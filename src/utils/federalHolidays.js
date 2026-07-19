// ─── US Federal Holidays (computed, not stored) ──────────────────────────────
//
// Returns all 11 federal holidays for a given year with observed-date shifting:
//   Saturday → Friday observed, Sunday → Monday observed.
// Pure function — safe to call at render time.

function toDs(d) { return d.toISOString().slice(0, 10); }

/** Observed date for a fixed-date holiday (shifts Sat→Fri, Sun→Mon). */
function observedDate(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() - 1); // Sat → Fri
  else if (dow === 0) d.setUTCDate(d.getUTCDate() + 1); // Sun → Mon
  return toDs(d);
}

/** nth occurrence of weekday in a month (n=1 = first, n=-1 = last). */
function nthWeekday(year, month, n, weekday) {
  if (n >= 0) {
    const d = new Date(Date.UTC(year, month - 1, 1));
    const diff = (weekday - d.getUTCDay() + 7) % 7;
    d.setUTCDate(1 + diff + (n - 1) * 7);
    return toDs(d);
  }
  // Last occurrence
  const d = new Date(Date.UTC(year, month, 0)); // last day of month
  const diff = (d.getUTCDay() - weekday + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return toDs(d);
}

/**
 * Returns all 11 US federal holidays for `year`, each as { date: 'YYYY-MM-DD', name: string }.
 * Dates are the *observed* dates (shifted for weekend collisions).
 */
export function getFederalHolidays(year) {
  return [
    { date: observedDate(year,  1,  1),   name: "New Year's Day"   },
    { date: nthWeekday(year,  1, 3, 1),   name: 'MLK Day'           },
    { date: nthWeekday(year,  2, 3, 1),   name: "Presidents' Day"   },
    { date: nthWeekday(year,  5, -1, 1),  name: 'Memorial Day'      },
    { date: observedDate(year,  6, 19),   name: 'Juneteenth'        },
    { date: observedDate(year,  7,  4),   name: 'Independence Day'  },
    { date: nthWeekday(year,  9, 1, 1),   name: 'Labor Day'         },
    { date: nthWeekday(year, 10, 2, 1),   name: 'Columbus Day'      },
    { date: observedDate(year, 11, 11),   name: 'Veterans Day'      },
    { date: nthWeekday(year, 11, 4, 4),   name: 'Thanksgiving'      },
    { date: observedDate(year, 12, 25),   name: 'Christmas'         },
  ];
}
