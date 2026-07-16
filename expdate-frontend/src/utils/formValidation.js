export function getFieldErrorMap(fields = {}, options = {}) {
  const { isWoMode = false } = options;
  const errors = {};

  if (!fields.barcode || !String(fields.barcode).trim()) {
    errors.barcode = true;
  }
  if (!fields.itemname || !String(fields.itemname).trim()) {
    errors.itemname = true;
  }
  if (!fields.quantity || !String(fields.quantity).trim()) {
    errors.quantity = true;
  }
  if (!isWoMode && (!fields.expdate || !String(fields.expdate).trim())) {
    errors.expdate = true;
  }

  return errors;
}
