export type VendorProfile = {
vendorDomain?: string;
industries?: string[];
regions?: string[];
buyers?: string[]; // seed buyer domains
};


export type ProgressKind =
| 'start' // job accepted
| 'status' // general heartbeat / spinner text
| 'metric' // a metric started/completed (for preview rail)
| 'lead' // a lead candidate was produced
| 'warn' // soft warning
| 'error' // hard error (job will complete next)
| 'done'; // job finished (success or partial)


export interface ProgressEvent {
t: number; // epoch ms
kind: ProgressKind;
msg?: string;
data?: any; // {ruleId, ruleName, step, of} etc.
}


export interface JobMeta {
id: string;
userId: string | null;
startedAt: number;
vendor: VendorProfile;
}
