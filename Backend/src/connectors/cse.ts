export type CseResult = { title: string; link: string; snippet?: string };


// Stub to keep builds green. Wire up real CSE later.
export async function searchCSE(q: string): Promise<CseResult[]> {
if (!q || !q.trim()) return [];
return [];
}


export default { searchCSE };
