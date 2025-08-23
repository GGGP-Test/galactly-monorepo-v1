export const nowPlusMinutes = (m: number) => new Date(Date.now() + m * 60000);
export const toISO = (d: Date) => d.toISOString();
