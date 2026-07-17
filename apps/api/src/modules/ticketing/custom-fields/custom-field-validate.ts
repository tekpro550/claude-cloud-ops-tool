export type CustomFieldType =
  'text' | 'number' | 'dropdown' | 'checkbox' | 'date';

export interface CustomFieldDef {
  key: string;
  label: string;
  field_type: CustomFieldType;
  options: string[];
  is_required: boolean;
  is_active: boolean;
}

/**
 * Validates and normalizes a submitted custom-field value map against the
 * active field definitions. Returns the cleaned map to store in
 * tickets.custom_fields. Pure and dependency-free so it can be unit-verified
 * without a database:
 *  - unknown keys (no active def) are dropped
 *  - a required field with no value throws
 *  - each value is coerced/checked per its field type (number is finite,
 *    dropdown is one of options, checkbox is boolean, date is YYYY-MM-DD,
 *    text is a string), throwing on a type mismatch
 *  - empty/omitted optional values are simply left out of the result
 */
export function validateCustomFields(
  defs: CustomFieldDef[],
  submitted: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  const values = submitted ?? {};
  const activeDefs = defs.filter((d) => d.is_active);
  const out: Record<string, unknown> = {};

  for (const def of activeDefs) {
    const raw = values[def.key];
    const provided = raw !== undefined && raw !== null && raw !== '';

    if (!provided) {
      if (def.is_required) {
        throw new Error(`Custom field "${def.label}" is required`);
      }
      continue;
    }

    switch (def.field_type) {
      case 'number': {
        const num = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(num)) {
          throw new Error(`Custom field "${def.label}" must be a number`);
        }
        out[def.key] = num;
        break;
      }
      case 'checkbox': {
        out[def.key] =
          raw === true || raw === 'true' || raw === 1 || raw === '1';
        break;
      }
      case 'dropdown': {
        const value = String(raw);
        if (!def.options.includes(value)) {
          throw new Error(
            `Custom field "${def.label}" must be one of: ${def.options.join(', ')}`,
          );
        }
        out[def.key] = value;
        break;
      }
      case 'date': {
        const value = String(raw);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          throw new Error(
            `Custom field "${def.label}" must be a date (YYYY-MM-DD)`,
          );
        }
        out[def.key] = value;
        break;
      }
      case 'text':
      default: {
        out[def.key] = String(raw);
        break;
      }
    }
  }

  return out;
}
