import { Router } from 'express';
import { startFindNow, getTask, createTask } from '../tasks';

export const router = Router();

/**
 * POST /api/v1/find-now
 * body: { website, regions, industries, seed_buyers, notes }
 * returns: { ok, previewTask, leadsTask, preview }
 */
router.post('/find-now', async (req, res) => {
  const uid = String(req.header('x-galactly-user') || 'u-anon');
  const profile = {
    website: String(req.body?.website || ''),
    regions: String(req.body?.regions || ''),
    industries: String(req.body?.industries || ''),
    seeds: String(req.body?.seed_buyers || ''),
    notes: String(req.body?.notes || '')
  };

  const previewTask = createTask(uid, 'preview');
  const leadsTask = createTask(uid, 'leads');

  startFindNow(profile, { previewTask, leadsTask }).catch(err => {
    previewTask.status = 'error';
    leadsTask.status = 'error';
    previewTask.error = String(err?.message || err);
    leadsTask.error = String(err?.message || err);
  });

  res.json({
    ok: true,
    previewTask: previewTask.id,
    leadsTask: leadsTask.id,
    preview: previewTask.lines.slice(-6)
  });
});

/**
 * GET /api/v1/preview/poll?task=ID&cursor=N
 * returns incremental lines
 */
router.get('/preview/poll', (req, res) => {
  const id = String(req.query.task || '');
  const cur = Math.max(0, Number(req.query.cursor || 0));
  const t = getTask(id);
  if (!t) return res.status(404).json({ ok: false, error: 'task_not_found' });
  const lines = t.lines.slice(cur);
  res.json({
    ok: true,
    done: t.status === 'done' || t.status === 'error',
    cursor: cur + lines.length,
    lines,
    error: t.error
  });
});

/**
 * GET /api/v1/leads/poll?task=ID&cursor=N
 * returns incremental leads
 */
router.get('/leads/poll', (req, res) => {
  const id = String(req.query.task || '');
  const cur = Math.max(0, Number(req.query.cursor || 0));
  const t = getTask(id);
  if (!t) return res.status(404).json({ ok: false, error: 'task_not_found' });
  const items = t.items.slice(cur);
  res.json({
    ok: true,
    done: t.status === 'done' || t.status === 'error',
    cursor: cur + items.length,
    items,
    error: t.error
  });
});
