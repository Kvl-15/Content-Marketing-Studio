// @ts-check

/** Base error for failures raised by the data import helpers. */
export class DataPipelineError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   * @param {Record<string, unknown>} [details]
   */
  constructor(message, code, details = {}) {
    super(message);
    this.name = "DataPipelineError";
    this.code = code;
    this.details = details;
  }
}

/** An input could not be interpreted as a supported data format. */
export class UnsupportedFormatError extends DataPipelineError {
  /** @param {string} message @param {Record<string, unknown>} [details] */
  constructor(message, details) {
    super(message, "UNSUPPORTED_FORMAT", details);
    this.name = "UnsupportedFormatError";
  }
}

/** A supported format contained invalid syntax. */
export class DataParseError extends DataPipelineError {
  /** @param {string} message @param {Record<string, unknown>} [details] */
  constructor(message, details) {
    super(message, "PARSE_ERROR", details);
    this.name = "DataParseError";
  }
}

/** A table could be parsed, but its structure is not usable. */
export class DataValidationError extends DataPipelineError {
  /** @param {string} message @param {Record<string, unknown>} [details] */
  constructor(message, details) {
    super(message, "VALIDATION_ERROR", details);
    this.name = "DataValidationError";
  }
}

/** A required role or identifier was not resolvable. */
export class DataRowError extends DataPipelineError {
  /** @param {string} message @param {string} code @param {Record<string, unknown>} [details] */
  constructor(message, code, details) {
    super(message, code, details);
    this.name = "DataRowError";
  }
}
