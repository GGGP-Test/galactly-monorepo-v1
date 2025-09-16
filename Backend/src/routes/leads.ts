import express from 'express';
import { discoverBuyers } from '../buyers/discovery';
import { processLeads } from '../buyers/pipeline';

const router = express.Router();

router.post('/find-buyers', async (req, res) => {
  try {
    const supplier = req.body;
    const leads = await discoverBuyers(supplier);
    const processedLeads = processLeads(leads);
    res.json(processedLeads);
  } catch (error) {
    console.error('Error finding buyers:', error);
    res.status(500).json({ error: 'Failed to find buyers' });
  }
});

export default router;
