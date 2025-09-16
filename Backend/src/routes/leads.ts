import express from 'express';
import { getLeads } from '../buyers/pipeline';
const router = express.Router();

router.post('/find-buyers', async (req, res) => {
  try {
    const supplier = req.body;
    const leads = await getLeads(supplier);
    if (leads.length < 3) {
      console.error('Not enough leads found');
      //Return demo leads here if necessary
    }
    res.json(leads);
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});
export default router;
