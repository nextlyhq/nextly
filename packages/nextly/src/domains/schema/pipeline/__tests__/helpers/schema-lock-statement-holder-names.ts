/**
 * What the statement holder sends, shared with the suite that asserts on its refusal: a literal
 * value no refusal may print, and the file the statement is sent for, whose name holds a space so
 * the name is carried encoded and read back decoded.
 */
export const HOLDER_LITERAL = "sk_live_holder_literal_value";

/** The migration file the holder's statement is sent for. */
export const HOLDER_UNIT = "0007_late value.sql";
