/** Thrown for invalid engine inputs (e.g. a non-positive rounding step). */
export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}
