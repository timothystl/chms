// Facilities photos and documents (migration 0012): pictures of equipment and nameplate labels,
// scanned service orders and invoices, attached to an asset, a recurring maintenance task, a
// service entry, or a capital project. The bytes live in Finance's own R2 bucket (FACILITY_FILES);
// finance_facility_files is the index, and a file is only ever served by its row id to a caller
// who may view Facilities. The stored type comes from the file's own leading bytes, so only real
// images and PDFs are kept and served, whatever name or type the browser sent.
import { FormValidationError, oneOf, optionalId, text } from './form-fields.js';

export const FILE_RECORD_TYPES = Object.freeze({
  asset: { table: 'finance_facility_assets', label: 'asset' },
  pm_task: { table: 'finance_facility_pm_tasks', label: 'task' },
  service: { table: 'finance_facility_service_log', label: 'service entry' },
  project: { table: 'finance_facility_projects', label: 'project' },
});

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 6;
// Checked from Content-Length before the body is read, so an oversized post never fills memory.
export const MAX_UPLOAD_REQUEST_BYTES = 64 * 1024 * 1024;

const EXTENSIONS = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/heic': 'heic', 'application/pdf': 'pdf',
};

// Browsers can show these inline as pictures; HEIC and PDF are listed as documents to open.
export const INLINE_IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export function sniffContentType(bytes) {
  const b = bytes;
  const ascii = (start, end) => String.fromCharCode(...b.slice(start, end));
  if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === 'PNG' && b[4] === 0x0D && b[5] === 0x0A) return 'image/png';
  if (b.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'image/gif';
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && ascii(4, 8) === 'ftyp' && ['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1', 'hevc'].includes(ascii(8, 12))) return 'image/heic';
  if (b.length >= 5 && ascii(0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

export function cleanFileName(name, contentType) {
  const base = String(name || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"<>]/g, '').trim().slice(0, 160);
  return base || `file.${EXTENSIONS[contentType] || 'bin'}`;
}

export function formatBytes(size) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function uploadedFiles(formData, field = 'files') {
  if (!formData) return [];
  return formData.getAll(field).filter((f) => f && typeof f === 'object' && typeof f.arrayBuffer === 'function' && f.size > 0);
}

async function requireRecord(db, recordType, recordId) {
  const { table, label } = FILE_RECORD_TYPES[recordType];
  const row = await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(recordId).first();
  if (!row) throw new FormValidationError(`That ${label} no longer exists.`);
}

// Validates every file before anything is stored, puts the bytes in R2, then indexes them in one
// batch. If indexing fails, the objects just written are removed again.
export async function attachFacilityFiles(db, bucket, { recordType, recordId, files, caption, actor }) {
  if (!files.length) return [];
  if (!bucket) throw new FormValidationError('Photo storage is not set up yet.');
  if (files.length > MAX_FILES_PER_UPLOAD) throw new FormValidationError(`Attach up to ${MAX_FILES_PER_UPLOAD} files at a time.`);
  const prepared = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) throw new FormValidationError(`${cleanFileName(file.name)} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentType = sniffContentType(bytes);
    if (!contentType) throw new FormValidationError(`${cleanFileName(file.name)} is not a photo or PDF.`);
    const key = `facilities/${recordType}/${recordId}/${crypto.randomUUID()}.${EXTENSIONS[contentType]}`;
    prepared.push({ key, bytes, contentType, fileName: cleanFileName(file.name, contentType) });
  }
  const written = [];
  try {
    for (const p of prepared) {
      await bucket.put(p.key, p.bytes, { httpMetadata: { contentType: p.contentType } });
      written.push(p.key);
    }
    await db.batch(prepared.map((p) => db.prepare('INSERT INTO finance_facility_files (record_type, record_id, object_key, file_name, content_type, byte_size, caption, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(recordType, recordId, p.key, p.fileName, p.contentType, p.bytes.byteLength, caption, String(actor || ''))));
  } catch (error) {
    await Promise.allSettled(written.map((key) => bucket.delete(key)));
    throw error;
  }
  return prepared.map((p) => p.key);
}

// Where the upload form sends the person back to: the record's own page.
export function recordReturn(recordType, recordId) {
  if (recordType === 'asset') return { page: 'assets', params: { asset: String(recordId) } };
  if (recordType === 'pm_task') return { page: 'preventive-maintenance', params: { task: String(recordId) } };
  if (recordType === 'service') return { page: 'service-history', params: { entry: String(recordId) } };
  return { page: 'capital-projects', params: { project: String(recordId) } };
}

export async function uploadFacilityFiles(db, form, actor, { formData, bucket } = {}) {
  const recordType = oneOf(form.record_type, Object.keys(FILE_RECORD_TYPES), 'record');
  const recordId = optionalId(form.record_id);
  if (!recordId) throw new FormValidationError('Unknown record.');
  const caption = text(form.caption, 200, 'Caption');
  const files = uploadedFiles(formData);
  if (!files.length) throw new FormValidationError('Choose a photo or PDF to attach.');
  await requireRecord(db, recordType, recordId);
  await attachFacilityFiles(db, bucket, { recordType, recordId, files, caption, actor });
  return recordReturn(recordType, recordId);
}

export async function removeFacilityFile(db, form, actor, { bucket } = {}) {
  const id = optionalId(form.id);
  if (!id) throw new FormValidationError('Unknown file.');
  const row = await db.prepare('SELECT id, record_type, record_id, object_key FROM finance_facility_files WHERE id = ?').bind(id).first();
  if (!row) throw new FormValidationError('That file was already removed.');
  await db.prepare('DELETE FROM finance_facility_files WHERE id = ?').bind(id).run();
  if (bucket) await bucket.delete(row.object_key).catch(() => {});
  return recordReturn(row.record_type, row.record_id);
}

// Removes every file attached to a record that is itself being deleted.
export async function removeRecordFiles(db, bucket, recordType, recordId) {
  const { results } = await db.prepare('SELECT object_key FROM finance_facility_files WHERE record_type = ? AND record_id = ?').bind(recordType, recordId).all();
  await db.prepare('DELETE FROM finance_facility_files WHERE record_type = ? AND record_id = ?').bind(recordType, recordId).run();
  if (bucket && results?.length) await Promise.allSettled(results.map((r) => bucket.delete(r.object_key)));
}

export function groupFilesByRecord(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.record_type}:${row.record_id}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

// Serves one file's bytes. The caller has already checked the viewer may see Facilities.
export async function serveFacilityFile(db, bucket, id, { head = false } = {}) {
  if (!/^\d+$/.test(String(id || ''))) return null;
  const row = await db.prepare('SELECT object_key, file_name, content_type FROM finance_facility_files WHERE id = ?').bind(Number(id)).first();
  if (!row || !bucket) return null;
  const object = head ? await bucket.head(row.object_key) : await bucket.get(row.object_key);
  if (!object) return null;
  const inlineImage = INLINE_IMAGE_TYPES.includes(row.content_type);
  const headers = {
    'Content-Type': row.content_type,
    'Content-Disposition': `${inlineImage || row.content_type === 'application/pdf' ? 'inline' : 'attachment'}; filename="${row.file_name.replace(/[^\x20-\x7e]/g, '_')}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  // A PDF opens in the browser's own viewer, which a sandboxed response would block.
  if (row.content_type !== 'application/pdf') headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";
  return { body: head ? null : object.body, headers, size: object.size };
}
