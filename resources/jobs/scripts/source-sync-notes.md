# Source Sync Notes

- Prefer ATS APIs first.
- Use the Greenhouse Job Board API when a board token is available.
- Use Lever's public postings feed when a company slug is available.
- Use Ashby's public hosted jobs endpoint when the organization slug is known.
- Use Recruitee's public offers API when the company subdomain is known.
- BambooHR sources need an explicit public API URL or endpoint discovery before enabling.
- Comeet, Workday, ADP, and other custom portals stay classified only until a safe integration path is approved.
- Org-specific career pages can be added later as approved sources.
- Official Greenhouse and Lever APIs are company-specific.
- Broad discovery should use API and search providers only and always route to pending review.
- Broad discovery results never auto-publish.
- Org-specific trusted ATS sources can auto-publish only when explicitly trusted and approved.
- Public submissions still require approval before they appear on the board.
- Never scrape LinkedIn.
- Never scrape Indeed directly.
- Unknown sources are never auto-published.
- All synced jobs should enter pending review before publication unless the source is explicitly marked trusted in the future.
- Only approved jobs should appear publicly on the board.
