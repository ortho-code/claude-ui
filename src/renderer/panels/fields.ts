/**
 * Reading the fields of a hand-written or script-written object through the list that names them.
 * A contract's fields are named in ONE list per object (a manifest's, a list document's); the checker reads a field only through that list, so a field it reads cannot be missing from it, and the contract's document is held to the same lists by a test.
 */

/** A reader of an object's fields that takes only the names in `fields`: a field read anywhere else is a type error, and reads as absent if a cast gets one past the types. */
export function fieldsOf<F extends readonly string[]>(raw: Record<string, unknown>, fields: F): (name: F[number]) => unknown {
  return (name) => (fields.includes(name) ? raw[name] : undefined);
}

/** The fields of `raw` that are not in `fields`: a later version's, or a typo. */
export function unknownFields(raw: Record<string, unknown>, fields: readonly string[]): string[] {
  return Object.keys(raw).filter((field) => !fields.includes(field));
}
