const express = require('express');
const router = express.Router();
const { processLeads } = require('../buyers/pipeline');

router.post('/find-buyers', async (req, res) => {
  try {
    const supplier = req.body;
    const leads = await processLeads(supplier);
    if (leads.length < 3) {
      // Return demo leads if less than 3 leads found
      console.warn('Less than 3 leads found, returning demo leads.');
      res.json([{ source: 'DEMO_SOURCE', url: 'demo', title: 'Demo Lead', company: 'Demo Company' }]);
    } else {
      res.json(leads);
    }
  } catch (error) {
    console.error('Error finding buyers:', error);
    res.status(500).json({ error: 'Failed to find buyers' });
  }
});

module.exports = router;