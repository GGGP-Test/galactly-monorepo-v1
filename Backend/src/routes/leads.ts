// ... [previous imports unchanged] ...

router.post('/find-buyers', async (req, res) => {
  try {
    // ... [previous validation unchanged] ...

    // Add geo-filter to discovery input
    const discovery = await runDiscovery({ 
      supplier: `${supplier} ${region}`, // Boost geo signals
      region: `${region} (USA OR Canada)`, 
      persona 
    });

    // Force US/CA filter in pipeline
    const { candidates } = await runPipeline(discovery, { 
      region: `${region} (USA OR Canada OR North America)`,
      radiusMi 
    });

    // Stricter demo fallback check
    const realCandidates = candidates.filter(c => c.source !== 'DEMO_SOURCE');
    const finalCandidates = realCandidates.length >= 3 
      ? realCandidates 
      : [...realCandidates, ...demoFallbacks];

    // ... [remaining response mapping unchanged] ...
  } catch (e) {
    // ... [error handling unchanged] ...
  }
});

export default router;