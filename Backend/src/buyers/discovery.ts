/* eslint-disable @typescript-eslint/no-explicit-any */
// ... [previous imports and bleedStore implementation unchanged] ...

function defaultCandidateSources(): CandidateSource[] {
  return [
    {
      id: "DUCKDUCKGO",
      kind: "SEARCH",
      description: "DuckDuckGo with US/CA site filters",
      urlTemplate: "https://duckduckgo.com/html/?q={query}",
      query: '("packaging distributor" OR "corrugated supplier" OR "protective packaging") site:.com | site:.ca | site:.us {region}'
    },
    {
      id: "KOMPASS",
      kind: "DIRECTORY",
      description: "Kompass North America filter",
      urlTemplate: "https://www.kompass.com/en/searchCompanies/?searchType=SUPPLIER&text={query}&countryCode=US,CA",
      query: "packaging distributor"
    },
    {
      id: "THOMASNET",
      kind: "DIRECTORY",
      description: "Thomasnet US directory",
      urlTemplate: "https://www.thomasnet.com/search.html?what={query}&cov=NA&heading=9212997",
      query: "Packaging Distributors"
    }
  ];
}

// ... [rest of file unchanged] ...