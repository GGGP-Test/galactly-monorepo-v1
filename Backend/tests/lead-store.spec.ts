import { LeadStore } from '../src/stores/lead-store';

describe('LeadStore', () => {
  it('upserts and dedupes by domain/name', () => {
    const store = new LeadStore();
    const a = store.upsert({ name: 'Acme Boxes LLC', website: 'https://acmeboxes.com', stage: 'new' });
    const b = store.upsert({ name: 'ACME BOXES', domain: 'acmeboxes.com', stage: 'qualified' });
    expect(a.id).toBe(b.id);
    const got = store.get(a.id)!;
    expect(got.stage).toBe('qualified'); // latest wins
  });

  it('queries by score and stage', () => {
    const store = new LeadStore();
    store.upsert({ name: 'Blue Films', domain: 'bluefilms.co', score: 88, stage: 'qualified' });
    store.upsert({ name: 'Red Wrap', domain: 'redwrap.com', score: 42, stage: 'new' });
    const res = store.query({ minScore: 60 });
    expect(res.length).toBe(1);
    expect(res[0].name).toMatch(/Blue/);
  });

  it('changes stage and emits events', (done) => {
    const store = new LeadStore();
    const lead = store.upsert({ name: 'Neo Pack', domain: 'neopack.io', stage: 'new' });
    store.on('event', (e: any) => {
      if (e.type === 'lead.stage-changed') {
        expect(e.from).toBe('new');
        expect(e.to).toBe('outreach');
        done();
      }
    });
    store.updateStage(lead.id, 'outreach');
  });
});
