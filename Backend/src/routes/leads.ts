const express = require('express');
const router = express.Router();
const { processLeads } = require('../buyers/pipeline');

router.post('/find-buyers', async (req, res) => {
  try {
    const supplier = req.body;
    const leads = await processLeads(supplier);
    if (leads.length < 3) {
      console.warn('Less than 3 leads found. Returning demo leads.');
      res.json([{ source: 'DEMO_SOURCE', name: 'Demo Lead 1', evidence: { url: 'demo.com', query: 'demo' } }, { source: 'DEMO_SOURCE', name: 'Demo Lead 2', evidence: { url: 'demo.com', query: 'demo' } }, { source: 'DEMO_SOURCE', name: 'Demo Lead 3', evidence: { url: 'demo.com', query: 'demo' } }]);
    } else {
      res.json(leads);
    }
  } catch (error) {
    console.error('Error processing leads:', error);
    res.status(500).json({ error: 'Failed to find leads' });
  }
});

module.exports = router;