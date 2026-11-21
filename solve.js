// Fast drop-in for csv-reader 1.0.0: identical answers, faster.
// Single-pass scanner: a tight charCodeAt loop finds each field's end, and
// slice() extracts whole fields (no per-character string concatenation, no
// regex match objects). Replicates the reference's broken-row policy exactly
// (see RULES.txt in the kit).

const COMMA = 0;
const BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  // Read an unquoted field starting at pos, appending onto `val`.
  // Returns [value, ended, added]; ended 0=COMMA, 1=BREAK, 2=END.
  // `added` counts characters appended (drives the quote_junk check).
  function readUnquoted(val) {
    let added = 0;
    let start = pos;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 44 || c === 10 || c === 13) {
        if (pos > start) {
          val += text.slice(start, pos);
          added += pos - start;
        }
        if (c === 44) {
          pos += 1;
          return [val, COMMA, added];
        }
        if (c === 10) {
          pos += 1;
          line += 1;
          return [val, BREAK, added];
        }
        // '\r'
        if (text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          return [val, BREAK, added];
        }
        // stray CR: drop it, record the error, keep going (added unchanged)
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos += 1;
        start = pos;
        continue;
      }
      pos += 1;
    }
    if (pos > start) {
      val += text.slice(start, pos);
      added += pos - start;
    }
    return [val, END, added];
  }

  // Read a quoted field whose opening quote is at pos. Returns [value, ended].
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let val = '';
    pos += 1;
    let closed = false;
    let start = pos;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 34) {
        if (pos > start) val += text.slice(start, pos);
        if (text.charCodeAt(pos + 1) === 34) {
          val += '"';
          pos += 2;
          start = pos;
          continue;
        }
        pos += 1;
        closed = true;
        break;
      }
      if (c === 13) {
        if (pos > start) val += text.slice(start, pos);
        // CRLF and a lone CR inside quotes are each one LF.
        val += '\n';
        line += 1;
        pos += text.charCodeAt(pos + 1) === 10 ? 2 : 1;
        start = pos;
        continue;
      }
      if (c === 10) {
        if (pos > start) val += text.slice(start, pos);
        val += '\n';
        line += 1;
        pos += 1;
        start = pos;
        continue;
      }
      pos += 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after
      // it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    if (pos >= n) return [val, END];
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return [val, COMMA];
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return [val, BREAK];
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return [val, BREAK];
    }
    // What follows the closing quote is appended as it stands.
    const junk = readUnquoted(val);
    if (junk[2] > 0) {
      errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    }
    return [junk[0], junk[1]];
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      const f = quoted ? readQuoted() : readUnquoted('');
      fields.push(f[0]);
      ended = f[1];
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
