import express from 'express';
import { processLeads } from '../buyers/pipeline';
const router = express.Router();

router.post('/find-buyers', async (req, res) => {
  try {
    const supplier = req.body;
    const leads = await processLeads(supplier);
    res.json(leads);
  } catch (error) {
    console.error('Error processing leads:', error);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});
export default router;
