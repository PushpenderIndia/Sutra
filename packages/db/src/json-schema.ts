import { z } from 'zod';

type Json = { [key: string]: unknown };

// The JSON Schema (draft 4) subset MongoDB's `$jsonSchema` accepts.
const KEYWORDS = new Set([
  'bsonType',
  'type',
  'enum',
  'required',
  'properties',
  'patternProperties',
  'additionalProperties',
  'items',
  'additionalItems',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'minProperties',
  'maxProperties',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'title',
  'description',
]);

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (!isObject(node)) return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'const') out.enum = [value];
    else if (key === 'type' && value === 'integer') out.type = 'number';
    // Unknown keys stay allowed, so a later PR adding a field never breaks old writes.
    else if (key === 'additionalProperties' && value === false) continue;
    else if (key === 'properties' || key === 'patternProperties')
      out[key] = Object.fromEntries(
        Object.entries(value as Json).map(([k, v]) => [k, sanitize(v)]),
      );
    else if (KEYWORDS.has(key)) out[key] = sanitize(value);
  }
  return out;
}

/** A MongoDB `$jsonSchema` validator generated from a Zod object schema. */
export function toMongoSchema(schema: z.ZodType): Json {
  const json = z.toJSONSchema(schema, {
    target: 'draft-4',
    unrepresentable: 'any',
    override: ({ zodSchema, jsonSchema }) => {
      if (zodSchema._zod.def.type === 'date') (jsonSchema as Json).bsonType = 'date';
    },
  });
  return sanitize(json) as Json;
}
