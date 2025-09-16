import express from 'express';
import { discoverBuyers } from '../buyers/discovery';
import { processLeads } from '../buyers/pipeline';

const router = express.Router();

router.post('/find-buyers', async (req, res) => {
  try {
    const supplier = req.body;
    const leads = await discoverBuyers(supplier);
    const processedLeads = processLeads(leads);
    if (processedLeads.length >= 3) {
      res.json(processedLeads);
    } else {
      res.status(500).json({ error: 'Not enough leads found' });
    }
  } catch (error) {
    console.error('Error finding buyers:', error);
    res.status(500).json({ error: 'Failed to find buyers' });
  }
});

export default router;
