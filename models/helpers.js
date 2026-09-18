/**
 * models/helpers.js
 * ------------------------------------------------------------------
 * Small shared helpers for the MongoDB data layers.
 */

/**
 * Normalise a lean Mongoose document (or array of them) for the API:
 * expose `_id` as `id` and drop Mongo-internal fields.
 */
function toPlain(doc) {
  if (!doc) return doc;
  if (Array.isArray(doc)) return doc.map(toPlain);
  const out = { ...doc };
  if (out._id !== undefined) {
    out.id = out._id.toString();
    delete out._id;
  }
  return out;
}

module.exports = { toPlain };
