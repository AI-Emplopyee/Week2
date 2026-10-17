/** Shared storage bounds, not customs field-length requirements. Never truncate facts to fit. */
export const SHIPMENT_TEXT_LIMITS = {
  maxComponentLength: 1000,
  maxValueLength: 10000,
  maxQuoteLength: 12000,
} as const;
