/**
 * The shape an output contract travels in, at the provider boundary
 * (spec 11.3, K-24).
 *
 * This sits below the adapter line, so it knows nothing about Songs, patches
 * or articulations — it is just "a JSON Schema document". What it is a schema
 * *of* is the caller's business; how it reaches a particular provider (a tool
 * definition, a `response_format`, a grammar) is the adapter's.
 *
 * Deliberately structural rather than a dependency. A schema package would
 * bring a validator we do not need — zod already validates on the way back in
 * — and a second opinion about what the contract is, which is exactly what
 * this type exists to prevent.
 */
export type JsonSchema = {
  readonly [key: string]: JsonSchemaValue;
};

export type JsonSchemaValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonSchemaValue[]
  | JsonSchema;
