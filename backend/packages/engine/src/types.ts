/** ISO weekday index: 0 = Monday … 6 = Sunday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type LogStatus = 'done' | 'failed';

/**
 * A versioned set of progression parameters. By construction, `startWeightLb` is
 * the prescribed working weight AT `effectiveFromIndex` — every revision seeds its
 * own weight, which keeps the progression walk free of revision-boundary special
 * cases.
 */
export interface RevisionParams {
  effectiveFromIndex: number;
  startWeightLb: number;
  incrementLb: number;
  failureMultiplier: number;
  roundingStepLb: number;
  sets: number;
  reps: number;
}

export interface LogEntry {
  occurrenceIndex: number;
  status: LogStatus;
  manualNextWeightLb?: number;
}

export interface Prescribed {
  occurrenceIndex: number;
  weightLb: number;
  sets: number;
  reps: number;
}

export interface Warning {
  code: string;
  message: string;
}
