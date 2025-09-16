const express = require('express');
const router = express.Router();
const { processLeads } = require('../buyers/pipeline');

router.post('/find-buyers', async (req, res) => {
  try {
    const supplier = req.body;
    const leads = await processLeads(supplier);
    if (leads.length < 3) {
      // Return demo leads if fewer than 3 leads are found
      res.json([{ name: 'Demo Lead 1', source: 'DEMO_SOURCE', url: '#' }, { name: 'Demo Lead 2', source: 'DEMO_SOURCE', url: '#' }, { name: 'Demo Lead 3', source: 'DEMO_SOURCE', url: '#' }]);
    } else {
      res.json(leads);
    }
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

module.exports = router;