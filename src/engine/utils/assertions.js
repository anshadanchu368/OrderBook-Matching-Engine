export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertNonEmptyString(fieldName, value) {
  assert(
    typeof value === "string" && value.trim() !== "",
    `${fieldName} must be a non-empty string`,
  );
}

export function assertPositiveNumber(fieldName, value) {
  assert(
    Number.isFinite(value) && value > 0,
    `${fieldName} must be a positive number`,
  );
}

export function assertPositiveInteger(fieldName, value) {
  assert(
    Number.isInteger(value) && value > 0,
    `${fieldName} must be a positive integer`,
  );
}

export function assertNonNegativeInteger(fieldName, value) {
  assert(
    Number.isInteger(value) && value >= 0,
    `${fieldName} must be a non-negative integer`,
  );
}
