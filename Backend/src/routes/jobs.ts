import { Router } from 'express';
import { createTask, getTask } from '../tasks';
import { startFindNow } from '../runner/findNowRunner';

export const router = Router();

/** submit a search */
router.post('/find-now', async (req, res) => {
  const uid = String(req.header('x-galactly-user') || 'u-anon');

  const profile = {
    website: String(req.body?.website || ''),
    regions: String(req.body?.regions || ''),
    industries: String(req.body?.industries || ''),
    seeds: String(req.body?.seed_buyers || ''),
    notes: String(req.body?.notes || ''),
  };

  const previewTask = createTask(uid, 'preview');
  const leadsTask = createTask(uid, 'leads');

  // fire & forget
  startFindNow(profile, { previewTask, leadsTask }).catch(err => {
    previewTask.status = 'error';
    previewTask.error = String(err?.message || err);
    leadsTask.status = 'error';
    leadsTask.error = String(err?.message || err);
  });

  res.json({
    ok: true,
    previewTask: previewTask.id,
    leadsTask: leadsTask.id,
    preview: previewTask.lines.slice(-6),
  });
});

/** long-poll preview text */
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
    error: t.error,
  });
});

/** long-poll leads */
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
    error: t.error,
  });
});
