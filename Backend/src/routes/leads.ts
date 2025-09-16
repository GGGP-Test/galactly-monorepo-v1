const express = require('express');
const router = express.Router();
const { processLeads } = require('../buyers/pipeline');

router.post('/find-buyers', async (req, res) => {
  try {
    const supplier = req.body;
    const leads = await processLeads(supplier);
    res.json(leads);
  } catch (error) {
    console.error('Error finding buyers:', error);
    res.status(500).json({ error: 'Failed to find buyers' });
  }
});

module.exports = router;