// Data provenance — the source bar under the header.
//
// A demo hands mount() a dataSource() describing what it actually loaded:
// who published it, what period the values cover, how many rows survived
// filtering. This is the only place provenance is stated — there is no
// system prompt to also carry it to a model, so an agent sharing the tab
// only sees it if it reads the page like a person would.
//
// It's a function, not an object: for these demos provenance is state. The
// row count, the year span, and the excluded count aren't known until the
// fetch lands — same reason the tool surface is a function of state.
//
// Descriptor fields (publisher + dataset required, rest optional):
//   publisher  'World Bank'
//   dataset    'World Development Indicators'
//   url        link to the source's own landing page
//   rows       '217 countries'                 — what survived, with its noun
//   excluded   '892 facilities: partial week'  — what didn't, and why
//   coverage   'latest reported year per country, 2015–2024'
//   retrieved  Date.now() at fetch
//   caveat     the thing a careless reader would otherwise get wrong

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function ago(ts) {
  if (!ts) return null;
  let value = (ts - Date.now()) / 1000;
  for (const [unit, span] of [['second', 60], ['minute', 60], ['hour', 24], ['day', 7]]) {
    if (Math.abs(value) < span) return RELATIVE.format(Math.round(value), unit);
    value /= span;
  }
  return RELATIVE.format(Math.round(value), 'week');
}

// Built as nodes rather than innerHTML: coverage and row counts interpolate
// values that came off a remote API, and this is the one place on the page
// where a source gets to name itself.
function span(className, text) {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

export function renderSourceBar(getDescriptor) {
  const bar = document.getElementById('source-bar');
  if (!bar) return;

  const d = getDescriptor?.();
  bar.textContent = '';
  // Hidden until the fetch lands, so a skeleton never sits under a source
  // line claiming rows that aren't there yet.
  bar.hidden = !d;
  if (!d) return;

  const line = document.createElement('p');
  line.className = 'source-line';

  const title = `${d.publisher} — ${d.dataset}`;
  if (d.url) {
    const link = document.createElement('a');
    link.className = 'source-origin';
    link.href = d.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.append(title);
    const arrow = span('source-arrow', ' ↗');
    arrow.setAttribute('aria-hidden', 'true');
    link.append(arrow, span('visually-hidden', ' (opens in a new tab)'));
    line.append(link);
  } else {
    line.append(span('source-origin', title));
  }

  const facts = [d.rows, d.coverage, d.excluded, ago(d.retrieved) && `retrieved ${ago(d.retrieved)}`]
    .filter(Boolean);
  for (const fact of facts) {
    const sep = span('source-sep', '·');
    sep.setAttribute('aria-hidden', 'true');
    line.append(sep, span('source-fact', fact));
  }
  bar.append(line);

  // The caveat carries its own text; the glyph is decoration on top of it,
  // never the thing doing the telling.
  if (d.caveat) {
    const note = document.createElement('p');
    note.className = 'source-caveat';
    const mark = span('source-caveat-mark', '⚠');
    mark.setAttribute('aria-hidden', 'true');
    note.append(mark, d.caveat);
    bar.append(note);
  }
}

