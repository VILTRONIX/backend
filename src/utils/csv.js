// Shared bounded tokenizer. No I/O, coercion, source-specific rules, or database access.
export function parseCsv(text, { maxRecords = Infinity, maxColumns = Infinity, maxFieldBytes = Infinity } = {}) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], field = '', state = 'unquoted', touched = false;
  const endField = () => {
    if (Buffer.byteLength(field) > maxFieldBytes || row.length >= maxColumns) throw new Error('CSV resource limit.');
    row.push(field); field = ''; state = 'unquoted';
  };
  const endRow = () => {
    if (rows.length > maxRecords) throw new Error('CSV record limit.');
    endField(); rows.push(row); row = []; touched = false;
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (field.length > maxFieldBytes) throw new Error('CSV field limit.');
    if (state === 'quoted') {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; }
        else state = 'closed';
      } else field += char;
      continue;
    }
    if (state === 'closed' && ![',', '\r', '\n'].includes(char)) throw new Error('CSV has characters after a closing quote.');
    if (char === '"') {
      if (field || state !== 'unquoted') throw new Error('CSV contains an unexpected quote.');
      state = 'quoted'; touched = true;
    } else if (char === ',') { endField(); touched = true; }
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      endRow();
    } else { field += char; touched = true; }
  }
  if (state === 'quoted') throw new Error('CSV contains an unterminated quoted field.');
  if (touched || row.length || field.length || state === 'closed') endRow();
  if (!rows.length) throw new Error('CSV is empty.');
  const headers = rows.shift();
  if (headers.some((header) => !header || header.trim() !== header) || new Set(headers).size !== headers.length) throw new Error('CSV headers must be non-empty, unique, and unpadded.');
  for (const [index, values] of rows.entries()) {
    if (values.length !== headers.length) throw new Error(`CSV record ${index + 2} has ${values.length} fields; expected ${headers.length}.`);
  }
  return { headers, rows };
}
