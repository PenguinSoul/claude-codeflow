import { CodedError, ERROR_CODES } from "./contracts.mjs";

export const SCHEMA_VERSION = 1;

export function assertSchema(value, kind, file = null) {
  if (
    !value ||
    typeof value !== "object" ||
    value.schemaVersion !== SCHEMA_VERSION
  ) {
    throw new CodedError(
      ERROR_CODES.SCHEMA_UNSUPPORTED,
      `${kind} artifact has an unsupported schemaVersion`,
      {
        file,
        expected: SCHEMA_VERSION,
        actual: value?.schemaVersion ?? null,
      },
      "Upgrade codeflow or restore a compatible artifact before retrying.",
    );
  }
  return value;
}

export function isSchemaSupported(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value.schemaVersion === SCHEMA_VERSION,
  );
}
