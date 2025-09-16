import express from 'express';
import { getLeads } from '../buyers/pipeline';
const router = express.Router();

router.post('/find-buyers', async (req, res) => {
  try {
    const supplierLocation = req.body.location;
    const leads = await getLeads({ location: supplierLocation });
    res.json(leads);
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

export default router;
