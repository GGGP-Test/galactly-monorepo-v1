import express from 'express';
import { processLeads } from '../buyers/pipeline';
const router = express.Router();

router.post('/find-buyers', async (req, res) => {
  try {
    const supplier = req.body;
    const leads = await processLeads(supplier);
    if (leads.length < 3) {
      console.warn('Less than 3 leads found. Returning demo leads.');
      res.json([{ name: 'Demo Lead 1', source: 'DEMO_SOURCE', url: '#' }, { name: 'Demo Lead 2', source: 'DEMO_SOURCE', url: '#' }, { name: 'Demo Lead 3', source: 'DEMO_SOURCE', url: '#' }]);
    } else {
      res.json(leads);
    }
  } catch (error) {
    console.error('Error finding buyers:', error);
    res.status(500).json({ error: 'Failed to find buyers' });
  }
});
export default router;